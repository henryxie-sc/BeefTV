package generation

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/url"
	"strings"
)

func prepareAPIMartImageReferences(ctx context.Context, input Input) (Input, error) {
	// Accepted tasks resume by GET and never upload or create another job.
	if ResumedProviderRequestID(ctx) != "" {
		return input, nil
	}
	switch strings.ToLower(input.Config.Quality) {
	case "1k", "2k", "4k":
		input.Config.VQuality = strings.ToLower(input.Config.Quality)
		input.Config.Quality = ""
	}
	if len(input.ReferenceImages) > 16 {
		return input, fmt.Errorf("APIMart 最多支持 16 张参考图")
	}
	input.ReferenceImages = append([]Media(nil), input.ReferenceImages...)
	for i, image := range input.ReferenceImages {
		parsed, err := url.Parse(image.URL)
		if err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "" {
			continue
		}
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		if err := writeMediaPart(writer, "file", image); err != nil {
			return input, err
		}
		if err := writer.Close(); err != nil {
			return input, err
		}
		var uploaded struct {
			URL   string         `json:"url"`
			Error *UpstreamError `json:"error"`
		}
		if err := PostForm(WithRequestKind(ctx, "upload"), input.Config, "/uploads/images", writer.FormDataContentType(), body, &uploaded); err != nil {
			return input, err
		}
		if uploaded.Error != nil {
			return input, fmt.Errorf("APIMart 参考图上传失败")
		}
		u, err := url.Parse(uploaded.URL)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return input, fmt.Errorf("APIMart 参考图上传未返回有效 URL")
		}
		input.ReferenceImages[i].URL = uploaded.URL
		input.ReferenceImages[i].DataURL = ""
	}
	return input, nil
}
