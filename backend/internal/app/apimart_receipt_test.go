package app

import (
	"infinite-canvas/backend/internal/model"
	"testing"
)

func TestAPIMartImageTaskIDRecorded(t *testing.T) {
	log := model.ApiCallLog{Capability: "image", RequestKind: "create", Path: "/v1/images/generations"}
	(&Service{}).EnrichAPICallLog(&log, []byte(`{"code":200,"data":[{"status":"submitted","task_id":"task-original"}]}`))
	if log.ProviderRequestID != "task-original" {
		t.Fatalf("lost task ID: %+v", log)
	}
}
