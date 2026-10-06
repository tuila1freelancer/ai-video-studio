// The stop valve for unattended operation.
//
// An agent can be told to stop asking, but the queue keeps its own promises: batched videos,
// calendar slots and requeued jobs all start themselves. Before a deploy, a provider outage or a
// bill that is climbing too fast, the user needs one switch that means "finish what is running and
// start nothing new" — and it has to survive a restart, or the restart undoes it.
import { getSetting, setSetting } from '../db/index.js';

const STATES = new Set(['running', 'paused', 'draining']);

/** @returns {{state:'running'|'paused'|'draining', at:number|null, by:string|null, reason:string|null}} */
export function opsState() {
  const s = getSetting('ops', null) || {};
  return {
    state: STATES.has(s.state) ? s.state : 'running',
    at: s.at || null,
    by: s.by || null,
    reason: s.reason || null,
  };
}

/** @param {'running'|'paused'|'draining'} state */
export function setOpsState(state, { by = null, reason = null } = {}) {
  if (!STATES.has(state)) throw new Error(`unknown ops state ${state}`);
  setSetting('ops', { state, at: Date.now(), by, reason: reason ? String(reason).slice(0, 200) : null });
  return opsState();
}

/** May the scheduler claim new work? Draining means "no" just as firmly as paused. */
export function acceptingWork() {
  return opsState().state === 'running';
}
