// Isolate Google's OAuth callbacks, credential cache and signals from the pi host.
import { AuthType, createContentGenerator } from '@google/gemini-cli-core/dist/src/core/contentGenerator.js';
import { Config } from '@google/gemini-cli-core/dist/src/config/config.js';
import { getOauthClient, clearCachedCredentialFile } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { coreEvents, CoreEvent } from '@google/gemini-cli-core/dist/src/utils/events.js';
import crypto from 'node:crypto';
import { configureCodexTransport as configureAccountTransport } from './codex-transport.mjs';

// Apply proxy dispatch after SDK imports; user-info requests use native fetch.
configureAccountTransport();

export function createGeminiConfig(noBrowser) {
  // Do not initialize Config: initialization would discover tools and start a
  // second agent. The content factory only needs its official configuration.
  return new Config({ sessionId: crypto.randomUUID(), clientName: 'beeftv', clientVersion: '1.7.3',
    targetDir: process.env.GEMINI_CLI_HOME, cwd: process.env.GEMINI_CLI_HOME,
    debugMode: false, model: process.env.BEEFTV_AGENT_MODEL || 'gemini-2.5-pro',
    proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
    acpMode: true, interactive: false, noBrowser,
    telemetry: { enabled: false, logPrompts: false }, usageStatisticsEnabled: false,
    billing: { overageStrategy: 'never' }, coreTools: [], mcpServers: {},
  });
}
let generator;
const requests = new Map();
coreEvents.on(CoreEvent.UserFeedback, (event) => {
  const match = String(event.message || '').match(/https:\/\/accounts\.google\.com\/[^\s]+/);
  if (match) process.send?.({ type: 'auth_url', url: match[0] });
});
function safeReason(error) {
  if (error instanceof TypeError) return 'oauth_sdk_contract_error';
  if (error.ineligibleTiers?.some((tier) => tier.reasonCode === 'UNSUPPORTED_CLIENT')) return 'oauth_client_unsupported';
  if (error.ineligibleTiers?.some((tier) => ['UNSUPPORTED_LOCATION', 'RESTRICTED_NETWORK', 'UNKNOWN_LOCATION'].includes(tier.reasonCode))) return 'oauth_region_restricted';
  const value = String(error?.message || '').toLowerCase();
  if (/project.*required|google_cloud_project/.test(value)) return 'oauth_project_required';
  if (/validation|verify your account/.test(value)) return 'oauth_verification_required';
  if (/429|quota|resource_exhausted/.test(value)) return 'gemini_quota_exceeded';
  if (/401|403|permission|unauthorized/.test(value)) return 'oauth_access_denied';
  if (/fetch|timeout|timed out|econn|enotfound|proxy/.test(value)) return 'oauth_network_error';
  return 'oauth_failed';
}
process.on('message', async (message) => {
  if (message.action === 'abort') { requests.get(message.id)?.abort(); return; }
  const controller = new AbortController();
  requests.set(message.id, controller);
  try {
    if (message.action === 'login') {
      const config = createGeminiConfig(false);
      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
      // Confirm Code Assist entitlement as well as browser authentication.
      generator = await createContentGenerator({ authType: AuthType.LOGIN_WITH_GOOGLE }, config, config.getSessionId());
      process.send?.({ id: message.id, ok: true });
    } else if (message.action === 'logout') {
      generator = undefined;
      await clearCachedCredentialFile();
      process.send?.({ id: message.id, ok: true });
    } else if (message.action === 'generate') {
      if (!generator) {
        const config = createGeminiConfig(true);
        generator = await createContentGenerator({ authType: AuthType.LOGIN_WITH_GOOGLE }, config, config.getSessionId());
      }
      // The official streaming request explicitly disables transport retries.
      const chunks = await generator.generateContentStream({ ...message.request,
        config: { ...message.request.config, abortSignal: controller.signal } }, crypto.randomUUID());
      const result = { candidates: [{ content: { parts: [] } }] };
      for await (const chunk of chunks) {
        const candidate = chunk.candidates?.[0];
        result.candidates[0].content.parts.push(...candidate?.content?.parts || []);
        if (candidate?.finishReason) result.candidates[0].finishReason = candidate.finishReason;
        if (chunk.usageMetadata) result.usageMetadata = chunk.usageMetadata;
      }
      process.send?.({ id: message.id, ok: true, result });
    }
  } catch (error) {
    process.send?.({ id: message.id, ok: false, reason: safeReason(error) });
  } finally { requests.delete(message.id); }
});
process.on('disconnect', () => process.exit(0));
