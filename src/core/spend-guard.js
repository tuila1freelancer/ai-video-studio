// The hard half of the budget.
//
// budgetState has always DOWNGRADED at the cap — llm off, voice pinned to the free chain — which is
// the right answer for a person watching: the video still finishes, cheaply. It is the wrong answer
// for a run nobody is watching, where "cheaper" can mean forty more videos in the wrong voice.
//
// With hardStop on, the two places money is actually spent refuse instead. Both already run inside
// the run context, so neither signature changes.
import { spendState } from './budget.js';
import { failed } from './errors.js';
import { currentRun } from '../util/run-context.js';
import { m } from '../i18n/t.js';

/** A cap check costs one indexed SUM; this keeps it to one per project per few seconds. */
const CACHE_MS = 5000;
const cache = new Map(); // projectId|channelId -> { at, state }

export function spendStateCached(where) {
  const key = `${where.projectId || ''}|${where.channelId || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  const state = spendState(where);
  cache.set(key, { at: Date.now(), state });
  return state;
}

/** Forget what was cached — used by tests and after a settings change. */
export function resetSpendCache() { cache.clear(); }

/**
 * Throw when a hard cap has been reached. Silent when hardStop is off (the downgrade in
 * buildContext still applies), and silent outside a run — a preview or a catalogue call is not
 * production spend.
 * @param {{projectId?:string|null, channelId?:string|null}} [where] defaults to the current run
 */
export function assertSpendAllowed(where = currentRun()) {
  const { projectId = null, channelId = null } = where || {};
  if (!projectId && !channelId) return;
  const state = spendStateCached({ projectId, channelId });
  if (!state.hardStop || !state.over.length) return;
  throw failed('budget.exceeded', m('đã chạm trần ngân sách — tạm dừng để tránh phát sinh chi phí'));
}
