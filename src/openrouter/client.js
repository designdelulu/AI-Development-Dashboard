const ORIGIN = 'https://openrouter.ai';
const ALLOWED = new Map([
  ['GET /api/v1/analytics/meta', null],
  ['POST /api/v1/analytics/query', null],
  ['GET /api/v1/credits', null]
]);

export class OpenRouterError extends Error {
  constructor(code, message, status = null) { super(message); this.code = code; this.status = status; }
}

function errorForStatus(status) {
  if (status === 401) return new OpenRouterError('invalid-credential', 'OpenRouter did not accept the management credential.', status);
  if (status === 403) return new OpenRouterError('insufficient-permission', 'The credential cannot access OpenRouter management analytics.', status);
  if (status === 429) return new OpenRouterError('rate-limited', 'OpenRouter rate-limited the request.', status);
  if (status >= 500) return new OpenRouterError('service-unavailable', 'OpenRouter is temporarily unavailable.', status);
  return new OpenRouterError('request-failed', `OpenRouter request failed (${status}).`, status);
}

export class OpenRouterClient {
  constructor({ credential, fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {}) {
    this.credential = credential;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, pathname, payload = null) {
    if (!this.credential) throw new OpenRouterError('credential-unavailable', 'No OpenRouter management credential is available.');
    if (!ALLOWED.has(`${method} ${pathname}`)) throw new OpenRouterError('endpoint-not-allowed', 'This OpenRouter endpoint is not allowed.');
    if (typeof this.fetchImpl !== 'function') throw new OpenRouterError('offline', 'Network access is unavailable.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${ORIGIN}${pathname}`, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.credential}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined
      });
      if (!response.ok) throw errorForStatus(response.status);
      const length = Number(response.headers?.get?.('content-length') || 0);
      if (length > 1_000_000) throw new OpenRouterError('response-too-large', 'OpenRouter returned an unexpectedly large response.');
      const text = await response.text();
      if (text.length > 1_000_000) throw new OpenRouterError('response-too-large', 'OpenRouter returned an unexpectedly large response.');
      try { return JSON.parse(text); } catch { throw new OpenRouterError('malformed-response', 'OpenRouter returned malformed JSON.'); }
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      if (error?.name === 'AbortError') throw new OpenRouterError('timeout', 'OpenRouter did not respond in time.');
      throw new OpenRouterError('offline', 'OpenRouter could not be reached.');
    } finally { clearTimeout(timer); }
  }

  meta() { return this.request('GET', '/api/v1/analytics/meta'); }
  analytics(payload) { return this.request('POST', '/api/v1/analytics/query', payload); }
  credits() { return this.request('GET', '/api/v1/credits'); }
}
