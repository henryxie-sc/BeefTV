import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { configureCodexTransport } from './codex-transport.mjs';

test('SDK fetch uses configured proxy but bypasses the local operation bridge', async () => {
  assert.equal(typeof ModelRuntime.create, 'function');
  const origin = http.createServer((_req, res) => res.end('ok'));
  let proxied = 0;
  const proxy = http.createServer((_req, res) => {
    proxied += 1;
    res.end('proxy');
  });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const keys = ['http_proxy', 'https_proxy', 'no_proxy', 'NO_PROXY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalDispatcher = getGlobalDispatcher();
  let dispatcher;
  try {
    process.env.http_proxy = `http://127.0.0.1:${proxy.address().port}`;
    process.env.https_proxy = process.env.http_proxy;
    process.env.no_proxy = ''; process.env.NO_PROXY = '';
    dispatcher = configureCodexTransport();
    assert.equal(await (await fetch('http://provider.invalid/auth', { signal: AbortSignal.timeout(3000) })).text(), 'proxy');
    assert.equal(proxied, 1);
    assert.equal(await (await fetch(`http://127.0.0.1:${origin.address().port}/ops`, { signal: AbortSignal.timeout(3000) })).text(), 'ok');
    assert.equal(proxied, 1);
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await dispatcher?.destroy();
    origin.closeAllConnections();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    origin.close(); proxy.close();
  }
});
