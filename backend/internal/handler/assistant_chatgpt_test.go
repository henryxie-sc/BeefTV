package handler

import (
	"infinite-canvas/backend/internal/agentops"
	"net/http"
	"testing"
)

func TestChatGPTConnectionIsExclusiveToProductUISession(t *testing.T) {
	env := newAssistantTestEnv(t, nil)
	reg, token, err := env.clients.RegisterKind("external", "cli", agentops.ClientReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/assistant/chatgpt/connection", "/assistant/chatgpt/connect", "/assistant/chatgpt/login", "/assistant/chatgpt/answer", "/assistant/chatgpt/cancel", "/assistant/chatgpt/logout", "/assistant/chatgpt/open", "/assistant/chatgpt/disable"} {
		method := http.MethodPost
		if path == "/assistant/chatgpt/connection" {
			method = http.MethodGet
		}
		response := env.callWithHeaders(t, method, path, "{}", map[string]string{"X-Beeftv-Client": reg.ID, "Authorization": "Bearer " + token})
		if response.Code != 403 {
			t.Fatalf("external client reached %s: %d", path, response.Code)
		}
	}
	response := env.call(t, http.MethodGet, "/assistant/chatgpt/connection", "")
	if response.Code != 200 || decodeEnvelope(t, response)["active"] != false {
		t.Fatalf("UI inactive connection: %d %s", response.Code, response.Body.String())
	}
}
