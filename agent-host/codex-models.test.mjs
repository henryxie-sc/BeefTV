import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { registerCodexModels, assistantThinkingLevel } from './codex-models.mjs';

test('Sol 6.1 registration retains native catalog and account OAuth', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'beeftv-sol-catalog-'));
  try {
    const runtime = await ModelRuntime.create({ authPath: path.join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
    const original = runtime.getModels('openai-codex').map(({ id }) => id);
    registerCodexModels(runtime);
    registerCodexModels(runtime);
    const models = runtime.getModels('openai-codex');
    for (const id of original) assert.ok(models.some((model) => model.id === id), `missing native model ${id}`);
    assert.equal(models.filter((model) => model.id === 'gpt-6.1-sol').length, 1);
    const model = runtime.getModel('openai-codex', 'gpt-6.1-sol');
    assert.equal(model.api, 'openai-codex-responses');
    assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api');
    assert.equal(assistantThinkingLevel(model), 'low');
    assert.equal(assistantThinkingLevel(runtime.getModel('openai-codex', 'gpt-6-sol')), 'off');
    assert.equal(runtime.hasConfiguredAuth('openai-codex'), false);
    let prompt;
    await assert.rejects(runtime.login('openai-codex', 'oauth', {
      notify() {}, prompt(request) { prompt = request; return Promise.reject(new Error('stop-before-login')); },
    }), /stop-before-login/);
    assert.ok(prompt.options.some(({ id }) => id === 'browser'));
    assert.ok(prompt.options.some(({ id }) => id === 'device_code'));

    const fakeToken = `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-only-account' } })).toString('base64url')}.test`;
    for (const reasoning of ['off', 'minimal', 'low']) {
      let payload;
      const response = streamSimple(model, { messages: [{ role: 'user', content: 'test', timestamp: 0 }] }, {
        apiKey: fakeToken, reasoning, transport: 'sse',
        onPayload(body) { payload = body; throw new Error('stop-before-network'); },
      });
      await response.result();
      assert.equal(payload.model, 'gpt-6.1-sol');
      assert.equal(payload.reasoning.effort, 'low');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
