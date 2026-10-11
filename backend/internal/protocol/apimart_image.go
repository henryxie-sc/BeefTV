package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// APIMart keeps the OpenAI create URL but returns an asynchronous task receipt.
// Wrap only this exact host; other OpenAI-compatible services keep their plugin.
func IsAPIMartImage(baseURL, interfaceType string) bool {
	u, err := url.Parse(baseURL)
	return err == nil && u.Scheme == "https" && strings.EqualFold(u.Hostname(), "api.apimart.ai") && interfaceType == "openai-image"
}

type APIMartImageAdapter struct{ Adapter }

func (a APIMartImageAdapter) BuildCreate(_ context.Context, c RequestContext) (RequestSpec, error) {
	r := c.Request
	if strings.TrimSpace(r.Model) == "" || strings.TrimSpace(r.Prompt) == "" {
		return RequestSpec{}, fmt.Errorf("APIMart 图片模型和提示词不能为空")
	}
	body := map[string]any{"model": r.Model, "prompt": r.Prompt, "n": max(1, r.ImageCount)}
	if r.Instructions != "" {
		body["prompt"] = r.Instructions + "\n\n" + r.Prompt
	}
	if r.AspectRatio != "" {
		body["size"] = r.AspectRatio
	}
	if r.Resolution != "" {
		body["resolution"] = strings.ToLower(r.Resolution)
	}
	if r.Quality != "" && r.Quality != "auto" {
		body["quality"] = r.Quality
	}
	var images []string
	for _, image := range r.Images {
		value := image.URL
		if value == "" {
			value = image.DataURL
		}
		if image.Role == "mask" {
			body["mask_url"] = value
			continue
		}
		u, err := url.Parse(value)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return RequestSpec{}, fmt.Errorf("APIMart 参考图必须先上传为可访问的图片 URL")
		}
		images = append(images, value)
	}
	if len(images) > 16 {
		return RequestSpec{}, fmt.Errorf("APIMart 最多支持 16 张参考图")
	}
	if len(images) > 0 {
		body["image_urls"] = images
	}
	if _, masked := body["mask_url"]; masked && len(images) == 0 {
		return RequestSpec{}, fmt.Errorf("APIMart 蒙版必须同时提供源图片")
	}
	headers := map[string]string{}
	if key, ok := r.Extra["idempotencyKey"].(string); ok && key != "" {
		headers["Idempotency-Key"] = key
	}
	path := "/v1/images/generations"
	if strings.EqualFold(strings.TrimSpace(r.Model), "midjourney") {
		// Midjourney has a separate submission and billing route; its size is --ar,
		// not an OpenAI pixel size. Native MJ flags remain available in prompt.
		path = "/v1/midjourney/generations"
		if _, masked := body["mask_url"]; masked {
			return RequestSpec{}, fmt.Errorf("APIMart Midjourney Imagine 不支持蒙版编辑")
		}
		delete(body, "model")
		delete(body, "n")
		delete(body, "resolution")
		if r.AspectRatio != "" {
			ratio, err := apimartMidjourneyRatio(r.AspectRatio)
			if err != nil {
				return RequestSpec{}, err
			}
			body["size"] = ratio
		}
		if quality, ok := body["quality"]; ok {
			switch quality {
			case "0.25", "0.5", "1", "2":
			default:
				return RequestSpec{}, fmt.Errorf("APIMart Midjourney quality 必须为 0.25、0.5、1 或 2，请使用自动质量或原生 --q 参数")
			}
		}
		if err := applyAPIMartMidjourneyOptions(body, r.ProviderOptions["apimart-midjourney"]); err != nil {
			return RequestSpec{}, err
		}
	}
	return RequestSpec{Method: http.MethodPost, Path: path, ContentType: "application/json", Body: body, Headers: headers, Auth: ManifestAuth{Type: "bearer", Field: "apiKey"}}, nil
}

func applyAPIMartMidjourneyOptions(body map[string]any, options map[string]any) error {
	for key, value := range options {
		invalid := func() error { return fmt.Errorf("APIMart Midjourney 参数 %s 无效", key) }
		switch key {
		case "speed", "version", "style", "negative_prompt", "extra", "cref", "sref", "dref":
			text, ok := value.(string)
			if !ok {
				return invalid()
			}
			if text == "" {
				continue
			}
			if key == "speed" && text != "relax" && text != "fast" && text != "turbo" {
				return invalid()
			}
			if key == "cref" || key == "sref" || key == "dref" {
				u, err := url.Parse(text)
				if err != nil || u.Scheme != "https" || u.Host == "" {
					return invalid()
				}
			}
		case "tile", "niji", "raw", "draft", "hd", "nsfw_check":
			if _, ok := value.(bool); !ok {
				return invalid()
			}
		case "seed", "stylize", "chaos", "weird", "iw", "cw", "sw", "dw", "repeat", "stop":
			encoded, err := json.Marshal(value)
			if err != nil {
				return invalid()
			}
			var number float64
			if err := json.Unmarshal(encoded, &number); err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
				return invalid()
			}
			limits := map[string][2]float64{"seed": {0, 4294967295}, "stylize": {0, 1000}, "chaos": {0, 100}, "weird": {0, 3000}, "iw": {0, 3}, "cw": {0, 100}, "sw": {0, 1000}, "dw": {0, 100}, "repeat": {2, 40}, "stop": {10, 100}}
			limit := limits[key]
			if number < limit[0] || number > limit[1] || (key != "iw" && key != "dw" && math.Trunc(number) != number) {
				return invalid()
			}
		default:
			return fmt.Errorf("APIMart Midjourney 不支持参数 %s", key)
		}
		body[key] = value
	}
	return nil
}

func apimartMidjourneyRatio(size string) (string, error) {
	parts := strings.FieldsFunc(strings.ToLower(strings.TrimSpace(size)), func(r rune) bool { return r == ':' || r == 'x' })
	if len(parts) == 2 {
		width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
		height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			a, b := width, height
			for b != 0 {
				a, b = b, a%b
			}
			return fmt.Sprintf("%d:%d", width/a, height/a), nil
		}
	}
	return "", fmt.Errorf("APIMart Midjourney 尺寸必须为有效比例或像素尺寸：%s", size)
}

func (a APIMartImageAdapter) BuildPoll(_ context.Context, c PollContext) (RequestSpec, error) {
	if strings.TrimSpace(c.TaskID) == "" {
		return RequestSpec{}, fmt.Errorf("APIMart 查询缺少原任务 ID")
	}
	return RequestSpec{Method: http.MethodGet, Path: "/v1/tasks/" + url.PathEscape(c.TaskID), Auth: ManifestAuth{Type: "bearer", Field: "apiKey"}}, nil
}

type apimartImageTask struct {
	ID     string `json:"id"`
	TaskID string `json:"task_id"`
	Status string `json:"status"`
	Error  struct {
		Message string `json:"message"`
	} `json:"error"`
	Result struct {
		Images []struct {
			URL json.RawMessage `json:"url"`
		} `json:"images"`
	} `json:"result"`
}

func parseAPIMartImage(body []byte) (CreateResult, error) {
	var envelope struct {
		Code  int             `json:"code"`
		Data  json.RawMessage `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return CreateResult{}, err
	}
	if envelope.Error.Message != "" || (envelope.Code != 0 && envelope.Code != 200) {
		return CreateResult{}, fmt.Errorf("APIMart 图片请求失败（code=%d）：%s", envelope.Code, envelope.Error.Message)
	}
	var task apimartImageTask
	if len(envelope.Data) > 0 && envelope.Data[0] == '[' {
		var tasks []apimartImageTask
		if err := json.Unmarshal(envelope.Data, &tasks); err != nil {
			return CreateResult{}, err
		}
		if len(tasks) != 1 {
			return CreateResult{}, fmt.Errorf("APIMart 未返回唯一的图片任务")
		}
		task = tasks[0]
	} else if err := json.Unmarshal(envelope.Data, &task); err != nil {
		return CreateResult{}, err
	}
	id := task.TaskID
	if id == "" {
		id = task.ID
	}
	r := CreateResult{TaskID: id, Status: StatusPending, Message: task.Error.Message}
	switch task.Status {
	case "submitted", "pending", "queued":
	case "processing", "running":
		r.Status = StatusProcessing
	case "failed":
		r.Status = StatusFailed
	case "cancelled", "canceled":
		r.Status = StatusCancelled
	case "completed", "succeeded":
		r.Status = StatusSucceeded
		r.Result = &Result{}
		for _, image := range task.Result.Images {
			var urls []string
			if err := json.Unmarshal(image.URL, &urls); err != nil {
				var single string
				if err := json.Unmarshal(image.URL, &single); err != nil {
					return CreateResult{}, fmt.Errorf("APIMart 图片 URL 格式无效")
				}
				urls = []string{single}
			}
			for _, value := range urls {
				if strings.TrimSpace(value) != "" {
					r.Result.Images = append(r.Result.Images, MediaReference{URL: value, Kind: "image", Ephemeral: true})
				}
			}
		}
		if len(r.Result.Images) == 0 {
			return CreateResult{}, fmt.Errorf("APIMart 任务完成但没有图片结果")
		}
	default:
		return CreateResult{}, fmt.Errorf("APIMart 图片任务状态无效：%s", task.Status)
	}
	if r.Status != StatusFailed && r.Status != StatusCancelled && id == "" {
		return CreateResult{}, fmt.Errorf("APIMart 未返回可查询的图片任务 ID")
	}
	return r, nil
}

func (a APIMartImageAdapter) ParseCreate(_ context.Context, body []byte) (CreateResult, error) {
	return parseAPIMartImage(body)
}
func (a APIMartImageAdapter) ParsePoll(_ context.Context, _ PollContext, body []byte) (PollResult, error) {
	r, err := parseAPIMartImage(body)
	return PollResult{TaskID: r.TaskID, Status: r.Status, Result: r.Result, Message: r.Message}, err
}
