// OAuth is owned by the pinned ModelRuntime, including PKCE, callback and refresh.
// Only login instructions and catalog metadata cross the local UI boundary.
export function createChatGPTAuth({ runtime, isBusy, onAuthenticated, getModel }) {
  let flow = null;
  let state = 'idle';
  let authUrl = '';
  let device = null;
  let prompt = null;
  let answer = null;
  let errorReason = '';

  const fail = (reason) => { const error = new Error(reason); error.reason = reason; throw error; };
  const safeAuthURL = (value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com') fail('oauth_url_invalid');
    return url.href;
  };
  const status = () => ({ active: true, connected: runtime.hasConfiguredAuth('openai-codex'), state,
    model: getModel()?.id || '', models: runtime.getModels('openai-codex').map(({ id, name }) => ({ id, name })),
    ...(authUrl ? { authUrl } : {}), ...(device ? { device } : {}), ...(prompt ? { prompt } : {}),
    ...(errorReason ? { errorReason } : {}) });

  async function cancel() {
    const pending = flow?.done;
    flow?.controller.abort();
    await pending;
    authUrl = ''; device = null; prompt = null; answer = null;
    state = 'idle';
    errorReason = '';
  }

  function start(method = 'browser') {
    if (isBusy()) fail('session_busy');
    if (flow) return status();
    if (!['browser', 'device_code'].includes(method)) fail('invalid_request');
    const current = { controller: new AbortController() };
    flow = current;
    state = 'pending'; authUrl = ''; device = null; prompt = null; errorReason = '';
    const timer = setTimeout(() => current.controller.abort(), 10 * 60 * 1000);
    timer.unref?.();
    current.done = runtime.login('openai-codex', 'oauth', {
      signal: current.controller.signal,
      notify(event) {
        if (flow !== current) return;
        if (event.type === 'auth_url') authUrl = safeAuthURL(event.url);
        if (event.type === 'device_code') device = { userCode: event.userCode, verificationUri: safeAuthURL(event.verificationUri) };
      },
      prompt(request) {
        if (request.type === 'select') {
          if (!request.options.some((option) => option.id === method)) return Promise.reject(new Error('Unsupported login method'));
          return Promise.resolve(method);
        }
        if (request.type !== 'manual_code') return Promise.reject(new Error('Unsupported login prompt'));
        prompt = { type: 'manual_code' };
        return new Promise((resolve, reject) => {
          const abort = () => { prompt = null; answer = null; reject(new Error('Login cancelled')); };
          if (request.signal?.aborted || current.controller.signal.aborted) { abort(); return; }
          request.signal?.addEventListener('abort', abort, { once: true });
          current.controller.signal.addEventListener('abort', abort, { once: true });
          answer = (value) => {
            request.signal?.removeEventListener('abort', abort);
            current.controller.signal.removeEventListener('abort', abort);
            prompt = null; answer = null; resolve(value);
          };
        });
      },
    }).then(async () => {
      if (flow !== current) return;
      await onAuthenticated();
      state = 'connected';
    }).catch((error) => {
      if (flow !== current) return;
      state = current.controller.signal.aborted ? 'idle' : 'error';
      if (state === 'error') {
        // SDK error text may include a token response. Return only a stable category.
        const message = String(error?.message || '').toLowerCase();
        errorReason = message.includes('unsupported_country_region_territory') ? 'oauth_region_restricted'
          : /fetch failed|timeout|timed out|econn|403|cloudflare|access denied/.test(message)
            ? 'oauth_network_error' : message.includes('state mismatch') ? 'oauth_state_mismatch' : 'oauth_failed';
      }
    }).finally(() => {
      clearTimeout(timer);
      if (flow === current) { flow = null; authUrl = ''; device = null; prompt = null; answer = null; }
    });
    return status();
  }

  async function logout() {
    if (isBusy()) fail('session_busy');
    await cancel();
    await runtime.logout('openai-codex');
    await onAuthenticated();
    state = 'idle';
  }

  return { status, start, cancel, logout, answer(value) {
    if (!answer || typeof value !== 'string' || !value.trim() || value.length > 8192) fail('invalid_request');
    answer(value.trim());
    return status();
  } };
}
