// Public pipeline API consumed by the REST layer.
import { runPipeline, renderOnly, regenOne, brandGenImpl, requestStop } from './runner.js';

const active = new Map(); // projectId -> Promise

export function startProject(projectId, { resume = false } = {}) {
  if (active.has(projectId)) return active.get(projectId);
  const p = runPipeline(projectId, { resume }).finally(() => active.delete(projectId));
  active.set(projectId, p);
  return p;
}

export function stopProject(projectId) { requestStop(projectId); }

export function renderProject(projectId, opts) {
  if (active.has(projectId)) return active.get(projectId);
  const p = renderOnly(projectId, opts).finally(() => active.delete(projectId));
  active.set(projectId, p);
  return p;
}

export function regenScene(sceneId, what) { return regenOne(sceneId, what); }

export function brandGen(body, file) { return brandGenImpl(body, file); }
