import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { convertMessages, convertTools } from '@earendil-works/pi-ai/api/google-shared';
import { DEFAULT_GEMINI_MODEL, PREVIEW_GEMINI_3_1_MODEL, BASE_GEMINI_FLASH_MODEL } from '@google/gemini-cli-core/dist/src/config/models.js';

export const GEMINI_PROVIDER = 'beeftv-gemini-account';
export const GEMINI_MODELS = [DEFAULT_GEMINI_MODEL, PREVIEW_GEMINI_3_1_MODEL, BASE_GEMINI_FLASH_MODEL].map((id) => ({ id, name: id }));

export function geminiRequest(model, context, options = {}) {
  return { model: model.id, contents: convertMessages(model, context), config: {
    ...(context.systemPrompt ? { systemInstruction: context.systemPrompt } : {}),
    ...(context.tools?.length ? { tools: convertTools(context.tools) } : {}),
    maxOutputTokens: options.maxTokens || model.maxTokens,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  } };
}

export function createGeminiAccount({ dataDir, getModel, isBusy, onAuthenticated, reserveRequest, forkWorker = fork }) {
  const accountHome = path.join(dataDir, 'gemini-account');
  fs.mkdirSync(accountHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(accountHome, 0o700);
  const credentialPath = path.join(accountHome, '.gemini', 'oauth_creds.json');
  const entitlementPath = path.join(accountHome, 'entitlement.json');
  let connected = false;
  try {
    const credential = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    const entitlement = JSON.parse(fs.readFileSync(entitlementPath, 'utf8'));
    connected = entitlement.connected === true && Boolean(credential.refresh_token || credential.access_token);
  } catch { /* Missing or incomplete credentials require explicit login. */ }
  let state = 'idle', authUrl = '', errorReason = '', child = null, loginPromise = null;
  const pending = new Map();
  const fail = (reason) => { const error = new Error(reason); error.reason = reason; return error; };
  function stopWorker() {
    const old = child; child = null;
    old?.kill();
    for (const request of pending.values()) request.reject(fail('oauth_cancelled'));
    pending.clear();
  }
  function worker() {
    if (child) return child;
    const current = forkWorker(new URL('./gemini-worker.mjs', import.meta.url), [], {
      execArgv: [],
      env: { ...process.env, GEMINI_CLI_HOME: accountHome },
      // OAuth URLs and SDK error bodies must never reach host logs.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    child = current;
    current.on('message', (message) => {
      if (child !== current) return;
      if (message.type === 'auth_url') {
        try {
          const url = new URL(message.url);
          if (url.protocol === 'https:' && url.host === 'accounts.google.com' && !url.username && !url.password) authUrl = url.href;
        } catch { /* Ignore invalid instructions from the worker. */ }
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result); else request.reject(fail(message.reason));
    });
    current.on('error', () => { if (child === current) stopWorker(); });
    current.on('exit', () => { if (child === current) stopWorker(); });
    return current;
  }
  function call(action, request, signal) {
    if (signal?.aborted) return Promise.reject(fail('aborted'));
    const current = worker(), id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => { const entry = pending.get(id); pending.delete(id); current.send?.({ action: 'abort', id }); entry?.reject(fail('aborted')); };
      const timer = setTimeout(() => { const entry = pending.get(id); pending.delete(id); current.send?.({ action: 'abort', id }); entry?.reject(fail('oauth_network_error')); }, action === 'login' ? 360000 : 180000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      pending.set(id, { resolve: (value) => { cleanup(); resolve(value); }, reject: (error) => { cleanup(); reject(error); } });
      signal?.addEventListener('abort', abort, { once: true });
      current.send({ id, action, request });
    });
  }
  const status = () => ({ active: true, connected, state, model: getModel()?.id || '', models: GEMINI_MODELS,
    ...(authUrl ? { authUrl } : {}), ...(errorReason ? { errorReason } : {}) });
  async function cancel() {
    if (loginPromise) { stopWorker(); await loginPromise; }
    authUrl = ''; errorReason = ''; state = 'idle';
  }
  function start(method = 'browser') {
    if (isBusy()) throw fail('session_busy');
    if (method !== 'browser') throw fail('invalid_request');
    if (loginPromise) return status();
    state = 'pending'; errorReason = ''; authUrl = '';
    loginPromise = call('login').then(async () => {
      fs.writeFileSync(entitlementPath, JSON.stringify({ connected: true }), { mode: 0o600 });
      connected = true; state = 'connected'; await onAuthenticated();
    }).catch(async (error) => {
      fs.writeFileSync(entitlementPath, JSON.stringify({ connected: false }), { mode: 0o600 });
      connected = false; state = error.reason === 'oauth_cancelled' ? 'idle' : 'error';
      errorReason = state === 'error' ? error.reason : '';
      await onAuthenticated();
    }).finally(() => { loginPromise = null; authUrl = ''; });
    return status();
  }
  async function logout() {
    if (isBusy()) throw fail('session_busy');
    await cancel(); await call('logout');
    fs.writeFileSync(entitlementPath, JSON.stringify({ connected: false }), { mode: 0o600 });
    connected = false; state = 'idle'; await onAuthenticated();
  }
  function streamSimple(model, context, options = {}) {
    const stream = createAssistantMessageEventStream();
    const output = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: [], timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    void (async () => {
      try {
        if (!connected) throw fail('credential_missing');
        reserveRequest(model.id);
        stream.push({ type: 'start', partial: output });
        const result = await call('generate', geminiRequest(model, context, options), options.signal);
        const candidate = result.candidates?.[0];
        if (!candidate?.content?.parts?.length || (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))) throw fail('gemini_empty_response');
        for (const part of candidate.content.parts) {
          const index = output.content.length;
          if (part.functionCall) {
            const call = { type: 'toolCall', id: part.functionCall.id || crypto.randomUUID(), name: part.functionCall.name, arguments: part.functionCall.args || {}, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) };
            output.content.push(call);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: output });
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: call, partial: output });
          } else if (typeof part.text === 'string' || part.thoughtSignature) {
            const text = part.text || '';
            const kind = part.thought ? 'thinking' : 'text';
            output.content.push(part.thought ? { type: kind, thinking: text, thinkingSignature: part.thoughtSignature } : { type: kind, text, textSignature: part.thoughtSignature });
            stream.push({ type: `${kind}_start`, contentIndex: index, partial: output });
            stream.push({ type: `${kind}_delta`, contentIndex: index, delta: text, partial: output });
            stream.push({ type: `${kind}_end`, contentIndex: index, content: text, partial: output });
          }
        }
        const usage = result.usageMetadata || {};
        output.usage.input = Math.max(0, (usage.promptTokenCount || 0) - (usage.cachedContentTokenCount || 0));
        output.usage.output = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
        output.usage.cacheRead = usage.cachedContentTokenCount || 0;
        output.usage.totalTokens = usage.totalTokenCount || 0;
        output.stopReason = output.content.some((part) => part.type === 'toolCall') ? 'toolUse' : candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop';
        stream.push({ type: 'done', reason: output.stopReason, message: output });
      } catch (error) {
        output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
        output.errorMessage = error.reason || 'gemini_request_failed';
        stream.push({ type: 'error', reason: output.stopReason, error: output });
      } finally { stream.end(output); }
    })();
    return stream;
  }
  return { status, start, cancel, logout, answer() { throw fail('invalid_request'); }, streamSimple, dispose: stopWorker };
}
