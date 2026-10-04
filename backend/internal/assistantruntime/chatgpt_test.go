package assistantruntime

import "testing"

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
