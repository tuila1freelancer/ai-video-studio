// P32 — the persistent, per-run Vietnamese processing journal ("Nhật ký xử lý").
// jlog() is the ONE write path: a DB row (survives reloads/restarts) + a live WS event.
// Run attribution rides the existing AsyncLocalStorage run context (util/run-context.js):
// the scheduler stamps jobId there, so out-of-run work (regen, edits) is NULL by design
// and a regen racing a running job can never be mis-stamped with that job's id.
import { hub } from '../ws/hub.js';
import { insertJournal, pruneJournal } from '../db/repositories/journal.js';
import { currentRun } from '../util/run-context.js';
import { bindJournal } from '../util/log.js';

// Retention runs on run-boundary kinds only — one COUNT per insert would be waste.
const PRUNE_KINDS = new Set(['enqueue', 'status', 'done', 'error']);

/**
 * @param {string|null} projectId NULL = system lane (scheduler/slot events with no project yet)
 * @param {{level?:string, stage?:string, sceneIdx?:number, kind?:string, msg:string,
 *          data?:object, jobId?:string}} entry — jobId overrides the ALS-attributed run id
 *          (used by enqueue events, where the job exists but no run context does yet).
 */
export function jlog(projectId, { level = 'info', stage = null, sceneIdx = null, kind = 'log', msg, data = null, jobId = null } = {}) {
  try {
    if (!msg) return;
    const row = {
      project_id: projectId || null,
      job_id: jobId || currentRun().jobId || null,
      ts: Date.now(), level, stage,
      scene_idx: sceneIdx == null ? null : sceneIdx,
      kind, msg: String(msg),
      data: data ? JSON.stringify(data) : null,
    };
    const id = insertJournal(row);
    const evt = { type: 'journal', id, ...row };
    if (projectId) hub.toProject(projectId, evt);
    else hub.broadcast(evt);
    if (PRUNE_KINDS.has(kind)) pruneJournal(projectId);
  } catch { /* the journal must never break the pipeline */ }
}

// util/log.js can't import us (util → pipeline would cycle); hand it the writer at load.
bindJournal((projectId, entry) => jlog(projectId, entry));
