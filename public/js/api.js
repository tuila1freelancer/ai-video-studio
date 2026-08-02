// Tiny API + WebSocket client. Every request checks res.ok (a 500/HTML reply becomes a
// readable error instead of a silent JSON-parse throw), carries a timeout, and idempotent
// GETs retry once on network/5xx failure.
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status || 0; }
}

const TIMEOUT_MS = 120000; // some endpoints (fetch-link, voice preview) legitimately take long

async function request(method, path, { body, formData } = {}) {
  const retries = method === 'GET' ? 1 : 0; // mutations must never silently double-fire
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('/api' + path, {
        method,
        headers: formData || body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: formData || (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { /* non-JSON body (proxy error page) */ } }
      if (!res.ok) throw new ApiError(data?.error || `HTTP ${res.status}${data ? '' : ` — ${text.slice(0, 120)}`}`, res.status);
      return data;
    } catch (e) {
      const retriable = !(e instanceof ApiError) || e.status >= 500;
      if (attempt < retries && retriable) { await new Promise((r) => setTimeout(r, 600)); continue; }
      throw e instanceof ApiError ? e : new ApiError(e.name === 'TimeoutError' ? 'Máy chủ không phản hồi (timeout)' : (e.message || 'Mất kết nối máy chủ'), 0);
    }
  }
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, body) => request('POST', p, { body: body || {} }),
  put: (p, body) => request('PUT', p, { body: body || {} }),
  patch: (p, body) => request('PATCH', p, { body: body || {} }),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, { formData }),
};

export function fileUrl(path) { return path ? '/api/file?path=' + encodeURIComponent(path) : ''; }

// Lock a button for the duration of an async action — a double-click on "Tạo video"/"Bắt đầu"
// must never create duplicate projects or start two pipelines.
export async function withLock(btn, fn) {
  if (btn && btn.dataset.busy) return undefined;
  if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } finally {
    if (btn) { delete btn.dataset.busy; btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

export class WS {
  constructor(onMsg) {
    this.onMsg = onMsg; this.sub = null; this.connect();
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch {} };
    this.ws.onopen = () => { this._open = true; if (this.sub) this.subscribe(this.sub); this.onMsg({ type: '_status', open: true }); };
    this.ws.onclose = () => { this._open = false; this.onMsg({ type: '_status', open: false }); setTimeout(() => this.connect(), 1500); };
    this.ws.onerror = () => {};
  }
  subscribe(projectId) {
    this.sub = projectId;
    if (this._open) this.ws.send(JSON.stringify({ type: 'subscribe', projectId }));
  }
}
