package handler

import (
	"infinite-canvas/backend/internal/agentops"
	"net/http"
	"strings"
	"testing"
)

func TestChatGPTConnectionIsExclusiveToProductUISession(t *testing.T) {
	env := newAssistantTestEnv(t, nil)
	reg, token, err := env.clients.RegisterKind("external", "cli", agentops.ClientReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"chatgpt", "gemini"} {
		for _, action := range []string{"connection", "connect", "login", "answer", "cancel", "logout", "open", "disable"} {
			path := "/assistant/" + mode + "/" + action
			method := http.MethodPost
			if strings.HasSuffix(path, "/connection") {
				method = http.MethodGet
			}
			response := env.callWithHeaders(t, method, path, "{}", map[string]string{"X-Beeftv-Client": reg.ID, "Authorization": "Bearer " + token})
			if response.Code != 403 {
				t.Fatalf("external client reached %s: %d", path, response.Code)
			}
		}
	}
	response := env.call(t, http.MethodGet, "/assistant/chatgpt/connection", "")
	if response.Code != 200 || decodeEnvelope(t, response)["active"] != false {
		t.Fatalf("UI inactive connection: %d %s", response.Code, response.Body.String())
	}
}
