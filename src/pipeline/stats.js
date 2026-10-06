// How long this project's own work actually takes.
//
// The change-cost table is only useful if the numbers are the user's, not a guess: scene
// complexity, resolution and machine load move per-scene render time by several times over. An
// exponential moving average over the project's own history converges fast and forgets a one-off
// stall, which is all the accuracy an "about how long" question needs.
//
// Deliberately not stored when a measurement looks impossible (a negative clock, an absurd
// outlier): a bad sample would poison the estimate for every later edit, and no estimate at all
// is honest in a way a wrong one is not — the table says "chưa có số liệu" instead.
import * as DB from '../db/index.js';

const ALPHA = 0.3; // new sample weight — ~5 runs to fully adopt a changed machine speed
const SANE = { render: [0.5, 600], tts: [0.2, 300], concat: [1, 7200] };

/**
 * @param {string} projectId
 * @param {'render'|'tts'|'concat'} key
 * @param {number} seconds one measurement
 */
export function recordStat(projectId, key, seconds) {
  const range = SANE[key];
  const s = +seconds;
  if (!range || !Number.isFinite(s) || s < range[0] || s > range[1]) return;
  try {
    const md = DB.getProject(projectId)?.metadata || {};
    const cur = +md.renderStats?.[key];
    const next = Number.isFinite(cur) && cur > 0 ? cur * (1 - ALPHA) + s * ALPHA : s;
    DB.updateProject(projectId, {
      metadata: { ...md, renderStats: { ...(md.renderStats || {}), [key]: +next.toFixed(2) } },
    });
  } catch { /* a timing statistic is never worth failing a render over */ }
}

/** Wrap a step so its duration is recorded whether it succeeds or throws. */
export async function timed(projectId, key, fn) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    recordStat(projectId, key, (Date.now() - t0) / 1000);
  }
}
