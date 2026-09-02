// Progress + retry WebSocket events, and the burned-in progress-bar timing plan.
// All UI-facing pipeline chatter goes through here so the message shapes stay in one place.
// Since P32 every emission also lands in the persistent journal (jlog) — the ticker/badges
// stay the at-a-glance layer, the journal is the audit layer.
import { hub } from '../ws/hub.js';
import { jlog } from './journal.js';
import { t } from '../i18n/t.js';

const STAGE_NAMES = { b2: 'Kịch bản', b5: 'Dựng cảnh', b34: 'Lồng tiếng + Phụ đề', b6: 'Render', b7: 'Ghép & Mix' };
// The stage names are the most-read strings the server produces — they are the pipeline itself,
// live on screen. Keyed by their own Vietnamese text, so nothing here had to change shape.
const STAGE_VI = new Proxy(STAGE_NAMES, { get: (o, k) => (o[k] ? t(`srv.${o[k]}`) : undefined) });
const stageStart = new Map(); // `${projectId}:${step}` -> ts (for journal durations)

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}p${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Emit a pipeline step transition (b2|b34|b5|b6|b7 → running|done). */
export function step(id, step, state, detail) {
  hub.toProject(id, { type: 'step', step, state, detail });
  const key = `${id}:${step}`;
  if (state === 'running') {
    stageStart.set(key, Date.now());
    jlog(id, { kind: 'step', stage: step, msg: `▶ ${STAGE_VI[step] || step}${detail ? ` — ${detail}` : ''}`, data: { state, detail } });
  } else if (state === 'done') {
    const t0 = stageStart.get(key); stageStart.delete(key);
    const durMs = t0 ? Date.now() - t0 : null;
    jlog(id, { kind: 'step', stage: step, level: 'success', data: { state, detail, durMs },
      msg: `✓ ${STAGE_VI[step] || step} hoàn tất${detail ? ` — ${detail}` : ''}${durMs ? ` (${fmtDur(durMs)})` : ''}` });
  }
}

/** Emit a free-text operation line for the ticker + journal.
 *  Percent-progress ticks (`… · 42%`, ~5/scene during render) stay ticker-only —
 *  journaling them would flood a 200-scene run with thousands of rows. */
export function op(id, text) {
  hub.toProject(id, { type: 'op', text });
  if (!/·\s*\d{1,3}%\s*$/.test(text)) jlog(id, { kind: 'op', msg: text });
}

/**
 * Build the onRetry callback for withRetry — drives the SPA's "đang tự thử lại" badges.
 * @param {string} id project id @param {string} stepName @param {number|null} [idx] scene index (null = step-level)
 */
export function retryHook(id, stepName, idx) {
  return (attempt, err) => {
    hub.toProject(id, { type: 'retry', scope: idx == null ? 'step' : 'scene', step: stepName, idx, attempt, msg: err.message });
    const msg = `🩹 ${idx != null ? `Cảnh ${idx + 1}: ` : ''}lỗi "${err.message.slice(0, 80)}" — đang tự thử lại (${attempt + 1})…`;
    hub.toProject(id, { type: 'op', text: msg }); // ticker only — the retry row below IS the journal line
    jlog(id, { kind: 'retry', level: 'warn', stage: stepName, sceneIdx: idx ?? null, msg, data: { attempt } });
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
