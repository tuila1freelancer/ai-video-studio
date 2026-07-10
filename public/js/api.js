// Tiny API + WebSocket client.
const J = (r) => r.json();
export const api = {
  get: (p) => fetch('/api' + p).then(J),
  post: (p, body) => fetch('/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(J),
  put: (p, body) => fetch('/api' + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(J),
  del: (p) => fetch('/api' + p, { method: 'DELETE' }).then(J),
  upload: (p, formData) => fetch('/api' + p, { method: 'POST', body: formData }).then(J),
};

export function fileUrl(path) { return path ? '/api/file?path=' + encodeURIComponent(path) : ''; }

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
