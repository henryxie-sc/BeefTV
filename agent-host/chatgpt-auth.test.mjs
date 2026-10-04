import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTAuth } from './chatgpt-auth.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ login, busy = false } = {}) {
  let connected = false;
  let notified = 0;
  const runtime = {
    hasConfiguredAuth: () => connected,
    getModels: () => [{ id: 'test-model', name: 'Test' }],
    login: async (provider, type, interaction) => { assert.equal(provider, 'openai-codex'); assert.equal(type, 'oauth'); await login(interaction); connected = true; },
    logout: async () => { connected = false; },
  };
  const auth = createChatGPTAuth({ runtime, isBusy: () => busy, getModel: () => ({ id: 'test-model' }), onAuthenticated: async () => { notified++; } });
  return { auth, notified: () => notified };
}

test('browser authorization exposes instructions only; manual callback connects and logout clears credential', async () => {
  const { auth, notified } = fixture({ login: async (interaction) => {
    assert.equal(await interaction.prompt({ type: 'select', options: [{ id: 'browser' }] }), 'browser');
    interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=test' });
    assert.equal(await interaction.prompt({ type: 'manual_code' }), 'secret-code');
  } });
  auth.start(); await tick();
  assert.equal(auth.status().state, 'pending');
  assert.match(auth.status().authUrl, /^https:\/\/auth.openai.com/);
  auth.answer('secret-code'); await tick();
  assert.equal(auth.status().connected, true);
  assert.equal(auth.status().authUrl, undefined);
  assert.equal(JSON.stringify(auth.status()).includes('secret-code'), false);
  await auth.logout();
  assert.equal(auth.status().connected, false);
  assert.equal(notified(), 2);
});

test('cancel waits for SDK cancellation before a new flow', async () => {
  const { auth } = fixture({ login: async (interaction) => { await interaction.prompt({ type: 'manual_code' }); } });
  auth.start(); await tick(); await auth.cancel();
  assert.equal(auth.status().state, 'idle');
  auth.start(); await tick(); assert.equal(auth.status().state, 'pending'); await auth.cancel();
});

test('callback abort cancels only manual prompt and allows SDK completion', async () => {
  const { auth } = fixture({ login: async (interaction) => {
    const controller = new AbortController();
    const manual = interaction.prompt({ type: 'manual_code', signal: controller.signal }).catch(() => {});
    controller.abort(); await manual;
  } });
  auth.start(); await tick(); assert.equal(auth.status().connected, true);
});

test('unknown auth URLs and SDK errors expose no credential or upstream error', async () => {
  const { auth } = fixture({ login: async (interaction) => { interaction.notify({ type: 'auth_url', url: 'https://evil.example/secret-token' }); } });
  auth.start(); await tick();
  assert.equal(auth.status().state, 'error');
  assert.equal(JSON.stringify(auth.status()).includes('secret-token'), false);
});

test('busy sessions cannot log in or log out', async () => {
  const { auth } = fixture({ busy: true });
  assert.throws(() => auth.start(), { reason: 'session_busy' });
  await assert.rejects(auth.logout(), { reason: 'session_busy' });
});
