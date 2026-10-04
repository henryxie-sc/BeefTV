import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGeminiAccount, geminiRequest } from './gemini-account.mjs';

const model = { id: 'gemini-2.5-pro', api: 'google-generative-ai', provider: 'beeftv-gemini-account', maxTokens: 4096, input: ['text', 'image'] };
function fixture(handle, reserveRequest = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'beeftv-gemini-test-'));
  let children = 0;
  const child = new EventEmitter();
  child.kill = () => child.emit('exit');
  child.send = (message) => queueMicrotask(() => handle(message, child));
  const auth = createGeminiAccount({ dataDir: dir, getModel: () => model,
    isBusy: () => false, onAuthenticated: async () => {}, reserveRequest,
    forkWorker: (_url, _args, options) => {
      expect(options.env.GEMINI_CLI_HOME).toBe(path.join(dir, 'gemini-account'));
      expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', 'ipc']);
      children++; return child;
    } });
  return { auth, child, children: () => children, cleanup: () => { auth.dispose(); rmSync(dir, { recursive: true, force: true }); } };
}
async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)); }

test('startup remains offline and OAuth instructions cannot expose credentials or arbitrary URLs', async () => {
  const f = fixture((message, child) => {
    child.emit('message', { type: 'auth_url', url: 'https://evil.test/?token=secret' });
    child.emit('message', { id: message.id, ok: true });
  });
  try {
    expect(f.children()).toBe(0);
    expect(f.auth.status().connected).toBe(false);
    f.auth.start(); await settle();
    expect(f.auth.status().connected).toBe(true);
    expect(f.auth.status().authUrl).toBeUndefined();
    expect(JSON.stringify(f.auth.status())).not.toContain('secret');
  } finally { f.cleanup(); }
});

test('Google request preserves images, tool responses and thought signatures', () => {
  const context = { systemPrompt: 'Only canvas tools', tools: [{ name: 'canvas_read', description: 'Read', parameters: { type: 'object', properties: {} } }], messages: [
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', mimeType: 'image/png', data: 'AA==' }] },
    { role: 'assistant', api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call1', name: 'canvas_read', arguments: {}, thoughtSignature: 'c2lnbmF0dXJl' }] },
    { role: 'toolResult', toolCallId: 'call1', toolName: 'canvas_read', content: [{ type: 'text', text: 'node found' }], isError: false },
  ] };
  const request = geminiRequest(model, context);
  expect(request.contents[0].parts[1].inlineData.data).toBe('AA==');
  expect(request.contents[1].parts[0].thoughtSignature).toBe('c2lnbmF0dXJl');
  expect(request.contents[2].parts[0].functionResponse.name).toBe('canvas_read');
  expect(request.config.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(context.tools[0].parameters);
});

test('pi receives Google tool calls and budget refusal prevents upstream dispatch', async () => {
  let generates = 0, reservations = 0;
  const f = fixture((message, child) => {
    if (message.action === 'generate') generates++;
    child.emit('message', { id: message.id, ok: true, result: { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'canvas_read', args: {} }, thoughtSignature: 'signed' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3, totalTokenCount: 23 } } });
  }, () => { if (++reservations > 1) throw new Error('budget exceeded'); });
  try {
    f.auth.start(); await settle();
    const result = await f.auth.streamSimple(model, { messages: [] }).result();
    expect(result.stopReason).toBe('toolUse');
    expect(result.content[0].thoughtSignature).toBe('signed');
    expect(result.usage.input).toBe(20);
    const refused = await f.auth.streamSimple(model, { messages: [] }).result();
    expect(refused.stopReason).toBe('error');
    expect(generates).toBe(1);
  } finally { f.cleanup(); }
});

test('cancelling OAuth stops the callback worker and settles pending login', async () => {
  const f = fixture(() => {});
  try { f.auth.start(); await f.auth.cancel(); expect(f.auth.status().state).toBe('idle'); expect(f.auth.status().connected).toBe(false); }
  finally { f.cleanup(); }
});

test('cached OAuth tokens alone do not imply Code Assist entitlement', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'beeftv-gemini-entitlement-'));
  mkdirSync(path.join(dir, 'gemini-account/.gemini'), { recursive: true });
  writeFileSync(path.join(dir, 'gemini-account/.gemini/oauth_creds.json'), JSON.stringify({ refresh_token: 'test-only' }));
  const auth = createGeminiAccount({ dataDir: dir, getModel: () => model, isBusy: () => false,
    onAuthenticated: async () => {}, reserveRequest: () => {}, forkWorker: () => { throw new Error('must remain offline'); } });
  try { expect(auth.status().connected).toBe(false); }
  finally { auth.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test('upstream client rejection stays disconnected and exposes a safe reason', async () => {
  const f = fixture((message, child) => child.emit('message', {
    id: message.id, ok: false, reason: 'oauth_client_unsupported',
  }));
  try {
    f.auth.start(); await settle();
    expect(f.auth.status().connected).toBe(false);
    expect(f.auth.status().errorReason).toBe('oauth_client_unsupported');
  } finally { f.cleanup(); }
});
