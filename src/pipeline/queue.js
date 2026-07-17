// Public pipeline API consumed by the REST layer. Same export surface as always; behind it,
// heavy long-running work (pipeline runs, manual renders) goes through the durable job
// ledger + scheduler so it survives crashes and shares the global resource governor.
// settings.queue.durable=false falls back to the original in-memory Map path.
import { runPipeline, renderOnly, regenOne, requestStop } from './runner.js';
import { submit } from './scheduler.js';
import { getSetting, cancelQueuedJobs, getProject, getScene } from '../db/index.js';
import { withRunContext } from '../util/run-context.js';

const active = new Map(); // projectId -> Promise (legacy fallback path)

function durable() { return getSetting('queue', {})?.durable !== false; }
const attributed = (projectId, fn) =>
  withRunContext({ projectId, channelId: getProject(projectId)?.channel_id || null }, fn);

export function startProject(projectId, { resume = false } = {}) {
  if (durable()) return submit({ kind: 'pipeline', projectId, payload: { resume } }).done;
  if (active.has(projectId)) return active.get(projectId);
  const p = attributed(projectId, () => runPipeline(projectId, { resume })).finally(() => active.delete(projectId));
  active.set(projectId, p);
  return p;
}

export function stopProject(projectId) {
  cancelQueuedJobs(projectId); // a queued job must not start after the user pressed stop
  requestStop(projectId);
}

export function renderProject(projectId, opts) {
  if (durable()) return submit({ kind: 'render', projectId, payload: opts || {} }).done;
  if (active.has(projectId)) return active.get(projectId);
  const p = attributed(projectId, () => renderOnly(projectId, opts)).finally(() => active.delete(projectId));
  active.set(projectId, p);
  return p;
}

// Interactive short-lived actions stay direct — queueing them would only add latency.
export function regenScene(sceneId, what) {
  const projectId = getScene(sceneId)?.project_id;
  return projectId ? attributed(projectId, () => regenOne(sceneId, what)) : regenOne(sceneId, what);
}

/** Enqueue one batch item (durable path; the scheduler serializes jobs sharing batchId). */
export function enqueueBatchItem(projectId, batchId) {
  return submit({ kind: 'pipeline', projectId, batchId, payload: {}, priority: -1 });
}
