// Lightweight logger that also fans out to the WebSocket hub (per-project log panel).
let hub = null;
export function bindHub(h) { hub = h; }

function ts() { return new Date().toISOString().slice(11, 19); }

export function log(level, msg, meta = {}) {
  const line = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  if (hub && meta.projectId) {
    hub.toProject(meta.projectId, { type: 'log', level, msg, at: Date.now() });
  }
}

export const logger = {
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta),
  debug: (m, meta) => process.env.AVS_DEBUG ? log('debug', m, meta) : void 0,
};
