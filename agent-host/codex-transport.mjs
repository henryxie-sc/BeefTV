import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export function configureCodexTransport() {
  // SDK imports install Undici 8's default Agent over Node's environment proxy.
  // Configure after those imports; keep the authenticated local bridge direct.
  const bypass = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
  const noProxy = [...new Set([...bypass.split(','), 'localhost', '127.0.0.1', '::1'])]
    .filter(Boolean).join(',');
  const dispatcher = new EnvHttpProxyAgent({ noProxy });
  setGlobalDispatcher(dispatcher);
  return dispatcher;
}
