// Tiny API + WebSocket client. Every request checks res.ok (a 500/HTML reply becomes a
// readable error instead of a silent JSON-parse throw), carries a timeout, and idempotent
// GETs retry once on network/5xx failure.
import { m } from './i18n.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status || 0; }
}

const TIMEOUT_MS = 120000; // some endpoints (fetch-link, voice preview) legitimately take long

// A desktop app talks to its own loopback server and carries no token; a server-mode instance
// opened in a browser does, and it lives where the browser keeps things — per origin, per device.
export function authToken() {
  try { return localStorage.avsToken || ''; } catch { return ''; } // private window
}
export function setAuthToken(value) {
  const token = String(value || '');
  try { localStorage.avsToken = token; } catch { /* nothing to remember it with */ }
  // The same token as a cookie, because a <link>, an <img> and a font face carry no headers — in
  // server mode the interface would otherwise load and then show nothing.
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `avs_token=${encodeURIComponent(token)}; path=/; max-age=31536000; SameSite=Strict${secure}`;
}
const authHeader = () => (authToken() ? { Authorization: `Bearer ${authToken()}` } : undefined);

// Once the server has asked for a token, asking it forty more times answers nothing: the boot
// fires a dozen requests, and every one of them would be its own 401 in the console.
let gated = false;
export function accessGated() { return gated; }

async function request(method, path, { body, formData } = {}) {
  if (gated) throw new ApiError(m('Cần API token'), 401);
  const retries = method === 'GET' ? 1 : 0; // mutations must never silently double-fire
  if (method !== 'GET') cached.clear(); // a mutation may change any catalogue a cached GET described
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('/api' + path, {
        method,
        headers: {
          ...(formData || body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...authHeader(),
        },
        body: formData || (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { /* non-JSON body (proxy error page) */ } }
      if (!res.ok) {
        // A licence that lapses mid-session shows up here first, as a 403 on whatever the owner
        // happened to click. One event, and the licence view repaints the lock screen — every
        // other caller keeps its normal error handling.
        // A server-mode instance answers this until a token is pasted; one event, and the access
        // screen asks for one instead of every caller reporting its own failure.
        if (res.status === 401 && data?.code === 'token_required') {
          gated = true;
          window.dispatchEvent(new CustomEvent('token-required', { detail: data }));
          throw new ApiError(data.message || m('Cần API token'), 401);
        }
        if (res.status === 403 && data?.error === 'license_required') {
          window.dispatchEvent(new CustomEvent('license-required', { detail: data }));
          throw new ApiError(data.message || m('Cần license để tiếp tục'), 403);
        }
        throw new ApiError(data?.error || `HTTP ${res.status}${data ? '' : ` — ${text.slice(0, 120)}`}`, res.status);
      }
      return data;
    } catch (e) {
      const retriable = !(e instanceof ApiError) || e.status >= 500;
      if (attempt < retries && retriable) { await new Promise((r) => setTimeout(r, 600)); continue; }
      throw e instanceof ApiError ? e : new ApiError(e.name === 'TimeoutError' ? m('Máy chủ không phản hồi (timeout)') : (e.message || m('Mất kết nối máy chủ')), 0);
    }
  }
}

// One request per URL at a time, and an optional short cache for catalogues: at boot three
// modules asked for /settings and two for /brands within the same tick.
const inflight = new Map();
const cached = new Map(); // path -> { at, data }
function getDeduped(p, { ttl = 0 } = {}) {
  const hit = ttl > 0 && cached.get(p);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  if (inflight.has(p)) return inflight.get(p);
  const job = request('GET', p).then((data) => {
    if (ttl > 0) cached.set(p, { at: Date.now(), data });
    return data;
  }).finally(() => inflight.delete(p));
  inflight.set(p, job);
  return job;
}

export const api = {
  /** @param {string} p @param {{ttl?:number}} [opts] `ttl` ms keeps the reply for later callers */
  get: (p, opts) => getDeduped(p, opts),
  /** Hand a reply obtained elsewhere (the /boot aggregate) to later GET callers of `p`. */
  seed: (p, data) => { cached.set(p, { at: Date.now(), data }); },
  post: (p, body) => request('POST', p, { body: body || {} }),
  put: (p, body) => request('PUT', p, { body: body || {} }),
  patch: (p, body) => request('PATCH', p, { body: body || {} }),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, { formData }),
};

export function fileUrl(path) { return path ? '/api/file?path=' + encodeURIComponent(path) : ''; }
/**
 * A downscaled copy of an image for a card. `version` (the row's updated_at) makes the URL
 * change when the file does, so the reply can be cached for a day.
 */
export function thumbUrl(path, w = 320, version = 0) {
  return path ? `/api/thumb?path=${encodeURIComponent(path)}&w=${w}&v=${version || 0}` : '';
}

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
    this.onMsg = onMsg; this.sub = null; this.attempt = 0; this.connect();
    // A tab that comes back from the background reconnects at once instead of waiting out a backoff.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this._open) this.reconnectNow(); });
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // A browser cannot set a header on a WebSocket, so the token rides the query string.
    const token = authToken();
    this.ws = new WebSocket(`${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    this.ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch {} };
    this.ws.onopen = () => { this._open = true; this.attempt = 0; if (this.sub) this.subscribe(this.sub); this.onMsg({ type: '_status', open: true }); };
    // Exponential backoff with jitter, 1.5 s → 30 s: a server that is down for a minute used to be
    // hammered every 1.5 s by every open tab.
    this.ws.onclose = () => {
      this._open = false; this.onMsg({ type: '_status', open: false });
      const delay = Math.min(30000, 1500 * 2 ** Math.min(this.attempt++, 5)) * (0.75 + Math.random() * 0.5);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    this.ws.onerror = () => {};
  }
  reconnectNow() { clearTimeout(this.timer); this.attempt = 0; this.connect(); }
  subscribe(projectId) {
    this.sub = projectId;
    if (this._open) this.ws.send(JSON.stringify({ type: 'subscribe', projectId }));
  }
}
