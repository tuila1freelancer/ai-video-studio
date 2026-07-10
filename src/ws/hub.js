// WebSocket hub — broadcasts pipeline progress/logs to connected SPA clients.
import { WebSocketServer } from 'ws';

export class Hub {
  constructor() { this.clients = new Set(); }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      ws.subscribed = null; // project id this socket cares about
      this.clients.add(ws);
      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(buf.toString());
          if (msg.type === 'subscribe') ws.subscribed = msg.projectId || null;
        } catch { /* ignore */ }
      });
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      this.send(ws, { type: 'hello', at: Date.now() });
    });
  }

  send(ws, obj) {
    if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ } }
  }

  // broadcast to every client
  broadcast(obj) { for (const ws of this.clients) this.send(ws, obj); }

  // send only to clients subscribed to this project (falls back to broadcast)
  toProject(projectId, obj) {
    const payload = { ...obj, projectId };
    for (const ws of this.clients) {
      if (!ws.subscribed || ws.subscribed === projectId) this.send(ws, payload);
    }
  }
}

export const hub = new Hub();
