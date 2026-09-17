// WebSocket hub — broadcasts pipeline progress/logs to connected SPA clients.
//
// Resilience: every per-project event lands in a bounded rolling buffer that is replayed
// on (re)subscribe, so a page reload mid-run restores the live activity feed instead of
// losing it; a ping/pong heartbeat reaps half-open sockets; a bufferedAmount guard sheds
// slow clients instead of ballooning memory during 200+ scene renders.
import { WebSocketServer } from 'ws';
import { WS_MAX_BUFFERED } from '../core/constants.js';

const REPLAY_MAX = 200;               // events kept per project
const REPLAY_PROJECTS = 12;           // most-recent projects buffered
const HEARTBEAT_MS = 30000;

export class Hub {
  constructor() {
    this.clients = new Set();
    this.replay = new Map(); // projectId -> [events]
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      ws.subscribed = null; // project id this socket cares about
      ws.isAlive = true;
      this.clients.add(ws);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(buf.toString());
          if (msg.type === 'subscribe') {
            ws.subscribed = msg.projectId || null;
            // replay the buffered feed so a reloaded page catches up instantly
            const events = msg.projectId ? this.replay.get(msg.projectId) : null;
            if (events?.length) this.send(ws, { type: 'replay', projectId: msg.projectId, events });
          }
        } catch { /* ignore */ }
      });
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      this.send(ws, { type: 'hello', at: Date.now() });
    });
    // heartbeat: a socket that misses one full interval is half-open — reap it
    this.hb = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) { try { ws.terminate(); } catch { /* gone */ } this.clients.delete(ws); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* gone */ }
      }
    }, HEARTBEAT_MS);
    this.hb.unref?.();
  }

  /** Shutdown: server.close() waits for every open socket, and a browser tab holds one forever. */
  close() {
    clearInterval(this.hb);
    for (const ws of this.clients) { try { ws.terminate(); } catch { /* gone */ } }
    this.clients.clear();
    this.wss?.close();
  }

  send(ws, obj) {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > WS_MAX_BUFFERED) return; // slow client: drop frames, keep the server healthy
    try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }

  buffer(projectId, payload) {
    if (!projectId) return;
    let arr = this.replay.get(projectId);
    if (!arr) {
      arr = [];
      this.replay.set(projectId, arr);
      // bound total memory: evict the oldest project's buffer
      if (this.replay.size > REPLAY_PROJECTS) this.replay.delete(this.replay.keys().next().value);
    }
    arr.push(payload);
    if (arr.length > REPLAY_MAX) arr.splice(0, arr.length - REPLAY_MAX);
  }

  // broadcast to every client
  broadcast(obj) { for (const ws of this.clients) this.send(ws, obj); }

  // send only to clients subscribed to this project (falls back to broadcast)
  toProject(projectId, obj) {
    const payload = { ...obj, projectId };
    this.buffer(projectId, payload);
    for (const ws of this.clients) {
      if (!ws.subscribed || ws.subscribed === projectId) this.send(ws, payload);
    }
  }
}

export const hub = new Hub();
