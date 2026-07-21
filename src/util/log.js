// Lightweight logger that fans out to the WebSocket hub (live log line) and, since P32,
// into the persistent journal. Both sinks are late-bound (bindHub/bindJournal) so this
// util stays import-cycle-free.
import { currentRun } from './run-context.js';

let hub = null;
let journal = null;
export function bindHub(h) { hub = h; }
export function bindJournal(j) { journal = j; }

function ts() { return new Date().toISOString().slice(11, 19); }

export function log(level, msg, meta = {}) {
  const line = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  // Attribution: explicit meta wins; warn/error inside a run auto-attach the run's project
  // via the ALS context — provider-level failures (TTS/whisper/imagegen fallbacks) explain
  // quality drops and MUST reach that project's journal even without threaded ids.
  const projectId = meta.projectId
    || ((level === 'warn' || level === 'error') ? currentRun().projectId : null);
  if (!projectId) return;
  if (hub) hub.toProject(projectId, { type: 'log', level, msg, at: Date.now() });
  if (journal && level !== 'debug') {
    journal(projectId, {
      level: meta.jlevel || level, stage: meta.stage || null,
      sceneIdx: meta.sceneIdx ?? null, kind: meta.kind || 'log',
      msg, data: meta.data || null,
    });
  }
}

export const logger = {
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta),
  debug: (m, meta) => process.env.AVS_DEBUG ? log('debug', m, meta) : void 0,
};
