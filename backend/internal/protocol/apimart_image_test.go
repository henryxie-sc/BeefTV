package protocol

import (
	"context"
	"testing"
)

func TestAPIMartMidjourneySubmission(t *testing.T) {
	a := APIMartImageAdapter{}
	for _, size := range []string{"2880x2880", "1:1"} {
		spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
			Model: "midjourney", Prompt: "sunset --v 6.1 --fast", AspectRatio: size,
			Resolution: "2K", Quality: "auto", Images: []MediaReference{{URL: "https://example.com/source.png"}},
		}})
		if err != nil {
			t.Fatal(err)
		}
		body := spec.Body.(map[string]any)
		if spec.Path != "/v1/midjourney/generations" || body["size"] != "1:1" || body["prompt"] != "sunset --v 6.1 --fast" || len(body["image_urls"].([]string)) != 1 {
			t.Fatalf("spec=%+v", spec)
		}
		for _, key := range []string{"model", "n", "resolution", "quality"} {
			if _, exists := body[key]; exists {
				t.Fatalf("unexpected %s: %+v", key, body)
			}
		}
	}
	for _, request := range []GenerationRequest{
		{Model: "midjourney", Prompt: "draw", AspectRatio: "0x2880"},
		{Model: "midjourney", Prompt: "draw", Quality: "high"},
		{Model: "midjourney", Prompt: "draw", Images: []MediaReference{{URL: "https://example.com/source.png"}, {Role: "mask", DataURL: "data:image/png;base64,YQ=="}}},
	} {
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("accepted %+v", request)
		}
	}
}

func TestAPIMartMidjourneyStructuredOptions(t *testing.T) {
	a := APIMartImageAdapter{}
	request := GenerationRequest{Model: "midjourney", Prompt: "draw --v 6.1", Quality: "0.5", ProviderOptions: map[string]map[string]any{
		"apimart-midjourney": {"version": "7", "speed": "fast", "stylize": 0, "seed": 42, "iw": 0.5, "niji": true, "raw": false, "negative_prompt": "blurry", "sref": "https://example.com/style.png"},
	}}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["version"] != "7" || body["speed"] != "fast" || body["stylize"] != 0 || body["raw"] != false || body["quality"] != "0.5" || body["iw"] != 0.5 {
		t.Fatalf("body=%+v", body)
	}
	for key, value := range map[string]any{"speed": "invalid", "chaos": 101, "seed": 1.5, "iw": -1, "raw": "true", "sref": "file:///secret", "n": 2} {
		request.ProviderOptions["apimart-midjourney"] = map[string]any{key: value}
		if _, err := a.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("accepted %s=%v", key, value)
		}
	}
}

func TestAPIMartImageAsyncReceiptAndResult(t *testing.T) {
	a := APIMartImageAdapter{}
	r, err := a.ParseCreate(context.Background(), []byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-original"}]}`))
	if err != nil || r.TaskID != "task-original" || r.Status != StatusPending || r.Result != nil {
		t.Fatalf("receipt=%+v err=%v", r, err)
	}
	p, err := a.ParsePoll(context.Background(), PollContext{}, []byte(`{"code":200,"data":{"id":"task-original","status":"completed","result":{"images":[{"url":["https://upload.apimart.ai/a.png","https://upload.apimart.ai/b.png"]}]}}}`))
	if err != nil || p.Status != StatusSucceeded || p.Result == nil || len(p.Result.Images) != 2 || !p.Result.Images[0].Ephemeral {
		t.Fatalf("poll=%+v err=%v", p, err)
	}
	for _, body := range []string{`{"code":200,"data":[{"status":"submitted"}]}`, `{"code":200,"data":{"id":"task-original","status":"completed"}}`, `{"code":402,"error":{"message":"balance"}}`} {
		if _, err := a.ParseCreate(context.Background(), []byte(body)); err == nil {
			t.Fatalf("accepted invalid result %s", body)
		}
	}
}

func TestAPIMartImageRequestAndHostBoundary(t *testing.T) {
	a := APIMartImageAdapter{}
	spec, err := a.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "gpt-image-2.5-flare", Prompt: "draw", AspectRatio: "1:1", Resolution: "2K", Extra: map[string]any{"idempotencyKey": "original"}, Images: []MediaReference{{URL: "https://example.com/source.png"}, {Role: "mask", DataURL: "data:image/png;base64,YQ=="}}}})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if spec.Path != "/v1/images/generations" || body["resolution"] != "2k" || body["mask_url"] == nil || spec.Headers["Idempotency-Key"] != "original" {
		t.Fatalf("spec=%+v", spec)
	}
	if _, exists := body["output_format"]; exists {
		t.Fatal("sent unsupported OpenAI parameter")
	}
	if !IsAPIMartImage("https://api.apimart.ai/v1", "openai-image") || IsAPIMartImage("https://api.apimart.ai.evil/v1", "openai-image") || IsAPIMartImage("https://api.openai.com", "openai-image") {
		t.Fatal("host boundary")
	}
	poll, err := a.BuildPoll(context.Background(), PollContext{TaskID: "task-original"})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/tasks/task-original" {
		t.Fatalf("poll=%+v err=%v", poll, err)
	}
}
