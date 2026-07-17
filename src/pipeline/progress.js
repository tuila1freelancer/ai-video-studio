// Progress + retry WebSocket events, and the burned-in progress-bar timing plan.
// All UI-facing pipeline chatter goes through here so the message shapes stay in one place.
import { hub } from '../ws/hub.js';

/** Emit a pipeline step transition (b2|b34|b5|b6|b7 → running|done). */
export function step(id, step, state, detail) { hub.toProject(id, { type: 'step', step, state, detail }); }
/** Emit a free-text operation line for the activity log. */
export function op(id, text) { hub.toProject(id, { type: 'op', text }); }

/**
 * Build the onRetry callback for withRetry — drives the SPA's "đang tự thử lại" badges.
 * @param {string} id project id @param {string} stepName @param {number|null} [idx] scene index (null = step-level)
 */
export function retryHook(id, stepName, idx) {
  return (attempt, err) => {
    hub.toProject(id, { type: 'retry', scope: idx == null ? 'step' : 'scene', step: stepName, idx, attempt, msg: err.message });
    op(id, `🩹 ${idx != null ? `Cảnh ${idx + 1}: ` : ''}lỗi "${err.message.slice(0, 80)}" — đang tự thử lại (${attempt + 1})…`);
  };
}

/**
 * Cumulative time offsets so the burned-in progress bar is continuous across the whole video.
 * The program is the script's scenes only (no synthetic cards — P31), so total = Σ durations.
 * @returns {{offsets:number[], total:number}}
 */
export function progressPlan(scenes, config) {
  const durs = scenes.map((s) => Math.max(1.5, s.duration || config.sceneDuration || 6));
  const offsets = []; let acc = 0;
  for (const d of durs) { offsets.push(acc); acc += d; }
  return { offsets, total: acc };
}
