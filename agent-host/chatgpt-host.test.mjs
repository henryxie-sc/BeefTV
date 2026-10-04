import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('real pinned SDK starts without API key, protects OAuth metadata and dispatches zero model requests', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'beeftv-chatgpt-test-'));
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: {
    ...process.env, BEEFTV_AGENT_PORT: '0', BEEFTV_AGENT_LISTEN_FD: '', BEEFTV_AGENT_DATA_DIR: dir,
    BEEFTV_AGENT_HOST_TOKEN: 'test-only-host-token', BEEFTV_AGENT_INSTANCE_NONCE: 'test-only-nonce',
    BEEFTV_AGENT_MODEL: 'gpt-6.1-sol', BEEFTV_AGENT_API: 'openai-codex-responses',
    BEEFTV_AGENT_BASE_URL: 'https://chatgpt.com/backend-api', BEEFTV_AGENT_API_KEY: '',
    BEEFTV_OPS_URL: 'http://127.0.0.1:1/api', BEEFTV_AGENT_LIFETIME_STDIN: '0',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', () => {});
  try {
    const base = await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/已启动 (http:\/\/127\.0\.0\.1:\d+)/); if (match) resolve(match[1]); });
      child.once('exit', (code) => reject(new Error(`Host exited ${code}`)));
    });
    const headers = { 'X-Beeftv-Agent-Token': 'test-only-host-token', 'X-Beeftv-Instance-Nonce': 'test-only-nonce' };
    assert.equal((await fetch(`${base}/oauth/status`)).status, 403);
    const status = await (await fetch(`${base}/oauth/status`, { headers })).json();
    assert.equal(status.active, true); assert.equal(status.connected, false);
    assert.equal(status.model, 'gpt-6.1-sol');
    assert.ok(status.models.some((model) => model.id === 'gpt-6.1-sol'));
    assert.ok(status.models.some((model) => model.id === 'gpt-6-astra'));
    const health = await (await fetch(`${base}/health`, { headers })).json();
    assert.equal(health.reason, 'credential_missing');
    assert.equal(health.requests.dispatched, 0);
    assert.equal((await stat(path.join(dir, 'pi-agent'))).mode & 0o777, 0o700);
    const bad = await fetch(`${base}/oauth/login`, { method: 'POST', headers, body: JSON.stringify({ method: 'invalid' }) });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).reason, 'invalid_request');
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
    await rm(dir, { recursive: true, force: true });
  }
});
