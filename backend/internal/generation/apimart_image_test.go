package generation

import (
	"context"
	"fmt"
	"infinite-canvas/backend/internal/protocol"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAPIMartImagePollsOriginalWithoutResubmission(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	posts, polls := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/images/generations":
			posts++
			fmt.Fprint(w, `{"code":200,"data":[{"status":"submitted","task_id":"original"}]}`)
		case "/v1/tasks/original":
			polls++
			if polls == 1 {
				fmt.Fprint(w, `{"code":200,"data":{"id":"original","status":"processing"}}`)
				return
			}
			fmt.Fprintf(w, `{"code":200,"data":{"id":"original","status":"completed","result":{"images":[{"url":[%q]}]}}}`, server.URL+"/image.png")
		case "/image.png":
			w.Header().Set("Content-Type", "image/png")
			fmt.Fprint(w, "image bytes")
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	input := Input{Mode: "image", Prompt: "draw", Config: Config{BaseURL: server.URL + "/v1", APIKey: "test", Model: "gpt-image-2.5-flare", InterfaceType: "openai-image", Size: "1:1"}}
	policy := DeclarativeProtocolPollPolicy("image")
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	ctx := WithRuntime(context.Background(), taskRuntime())
	adapter := protocol.APIMartImageAdapter{}
	result, err := RunProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
	if err != nil || posts != 1 || polls != 2 || result["mode"] != "image" {
		t.Fatalf("posts=%d polls=%d result=%v err=%v", posts, polls, result, err)
	}
	ctx = WithRuntime(context.Background(), taskRuntime(func(r *Runtime) { r.Call.ProviderRequestID = "original" }))
	_, err = RunProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
	if err != nil || posts != 1 || polls != 3 {
		t.Fatalf("resume resubmitted: posts=%d polls=%d err=%v", posts, polls, err)
	}
}

func TestAPIMartLocalReferenceUploadAndResume(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	uploads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/uploads/images" || r.Method != "POST" {
			t.Errorf("unexpected request %s", r.URL.Path)
		}
		uploads++
		file, _, err := r.FormFile("file")
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		file.Close()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"url":"https://upload.apimart.ai/reference.png"}`)
	}))
	defer server.Close()
	input := Input{Config: Config{BaseURL: server.URL + "/v1", APIKey: "test", Quality: "2k"}, ReferenceImages: []Media{{DataURL: "data:image/png;base64,YQ=="}}}
	ctx := WithRuntime(context.Background(), taskRuntime())
	prepared, err := prepareAPIMartImageReferences(ctx, input)
	if err != nil || uploads != 1 || prepared.ReferenceImages[0].URL != "https://upload.apimart.ai/reference.png" || prepared.Config.VQuality != "2k" || prepared.Config.Quality != "" {
		t.Fatalf("uploads=%d prepared=%+v err=%v", uploads, prepared, err)
	}
	if input.ReferenceImages[0].URL != "" {
		t.Fatal("mutated input references")
	}
	ctx = WithRuntime(context.Background(), taskRuntime(func(r *Runtime) { r.Call.ProviderRequestID = "original" }))
	_, err = prepareAPIMartImageReferences(ctx, input)
	if err != nil || uploads != 1 {
		t.Fatalf("resume uploaded again: %d %v", uploads, err)
	}
}
