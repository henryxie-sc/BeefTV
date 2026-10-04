package assistantruntime

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestChatGPTSupervisorAllowsLoginBeforeModelReadiness(t *testing.T) {
	const nonce = "oauth-startup-test"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"ok":false,"reason":"credential_missing","instance":%q}`, InstanceProof(nonce))
	}))
	defer server.Close()
	done := make(chan struct{})
	if err := waitChildReady(server.URL, nonce, "test", time.Second, done, true); err != nil {
		t.Fatal(err)
	}
	if err := waitChildReady(server.URL, nonce, "test", 50*time.Millisecond, done, false); err == nil {
		t.Fatal("API mode must still require model readiness")
	}
	if err := waitChildReady(server.URL, "wrong-instance", "test", 50*time.Millisecond, done, true); err == nil {
		t.Fatal("OAuth mode must still verify owned process identity")
	}
}

func TestChatGPTProviderUsesSDKAuthWithoutChannelAPIKey(t *testing.T) {
	host := New(Options{DataDir: t.TempDir()})
	if err := host.WriteConfig(HostConfig{AuthMode: "chatgpt", Model: "gpt-6-astra"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BEEFTV_AGENT_API_KEY", "unrelated-channel-secret")
	provider, reason := host.ResolveProvider()
	if reason != "" || provider.APIKey != "" || provider.Protocol != "openai-codex" {
		t.Fatalf("unexpected OAuth provider: %#v reason=%s", provider, reason)
	}
	if hostAPI(provider.Protocol) != "openai-codex-responses" || hostBaseURL(provider.BaseURL, provider.Protocol) != "https://chatgpt.com/backend-api" {
		t.Fatal("Codex must use SDK protocol and exact base URL")
	}
	if err := host.WriteConfig(HostConfig{AuthMode: "chatgpt"}); err != nil {
		t.Fatal(err)
	}
	if _, reason := host.ResolveProvider(); reason != "model_not_configured" {
		t.Fatalf("missing model: %s", reason)
	}
}

func TestChatGPTEnvEnablesProxyAndBypassesLocalOperationBridge(t *testing.T) {
	host := New(Options{DataDir: t.TempDir(), Environ: func() []string {
		return []string{"HTTPS_PROXY=http://127.0.0.1:7897", "no_proxy=example.test", "NODE_USE_ENV_PROXY=0"}
	}})
	provider := testProvider()
	provider.Protocol = "openai-codex"
	env := host.buildEnv(provider, testPin("http://127.0.0.1:18090/api", "test"))
	if envValue(env, "NODE_USE_ENV_PROXY") != "1" {
		t.Fatal("Node fetch must honor configured proxy")
	}
	if envValue(env, "HTTPS_PROXY") != "http://127.0.0.1:7897" {
		t.Fatal("existing proxy must remain unchanged")
	}
	want := "example.test,localhost,127.0.0.1,::1"
	if envValue(env, "NO_PROXY") != want || envValue(env, "no_proxy") != want {
		t.Fatal("local bridge and inherited bypass must remain direct")
	}
}
