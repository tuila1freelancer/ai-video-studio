import { $, el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { m } from '../i18n.js';

// Pipeline progress engine: weighted B2→B7 percent + step badges + current-op line + log.
// Scenes-first order: visuals (b5) run BEFORE the voice (b34) so the owner can review the
// storyboard at the scene gate without spending TTS credits.
// `n` is a getter: PIPE is built at import time, before the catalogue has been fetched.
export const PIPE = [
  { k: 'b2', icn: 'edit', get n() { return m('Kịch bản'); } },
  { k: 'b5', icn: 'wand', get n() { return m('Dựng cảnh'); } },
  { k: 'b34', icn: 'mic', get n() { return m('TTS + Phụ đề'); } },
  { k: 'b6', icn: 'film', get n() { return m('Render'); } },
  { k: 'b7', icn: 'scissors', get n() { return m('Ghép & Mix'); } },
];
export const PHASE_W = { b2: 8, b5: 25, b34: 32, b6: 25, b7: 10 };
export const PHASE_ORDER = ['b2', 'b5', 'b34', 'b6', 'b7'];
export let prog = { total: 0, counts: { tts: 0, html: 0, rendered: 0 }, step: 'b2' };

export function resetProgress() { prog = { total: 0, counts: { tts: 0, html: 0, rendered: 0 }, step: 'b2' }; setProgress(0); }
export function setProgress(p) { p = Math.max(0, Math.min(100, Math.round(p))); const b = document.querySelector('#progBar'); if (b) b.style.width = p + '%'; const t = document.querySelector('#progPct'); if (t) t.textContent = p + '%'; }
function baseUpTo(step) { let s = 0; for (const k of PHASE_ORDER) { if (k === step) break; s += PHASE_W[k]; } return s; }
export function recomputeProgress() {
  const frac = (st) => (prog.total ? Math.min(1, prog.counts[st] / prog.total) : 0);
  let p = baseUpTo(prog.step);
  if (prog.step === 'b34') p += PHASE_W.b34 * frac('tts');
  else if (prog.step === 'b5') p += PHASE_W.b5 * frac('html');
  else if (prog.step === 'b6') p += PHASE_W.b6 * frac('rendered');
  setProgress(p);
}

// WS bursts mark the progress dirty; one rAF writer per frame touches the DOM.
let progDirty = false;
export function markProgressDirty() {
  if (progDirty) return;
  progDirty = true;
  requestAnimationFrame(() => { progDirty = false; recomputeProgress(); });
}

export function buildPipeSteps() {
  const box = $('#pipeSteps'); box.innerHTML = '';
  PIPE.forEach((s, i) => {
    if (i) box.appendChild(el('i', 'pline'));
    const d = el('div', 'pstep'); d.id = 'pstep-' + s.k;
    d.innerHTML = `<span class="pic">${icon(s.icn, 14)}</span><div class="pmeta"><div class="pn">${s.n}</div><div class="pd" id="pd-${s.k}"></div></div>`;
    box.appendChild(d);
  });
}
export function setStep(k, state2, detail) {
  const d = $('#pstep-' + k); if (!d) return;
  d.classList.remove('running', 'done', 'error');
  if (state2 !== 'idle') d.classList.add(state2);
  if (detail != null) $('#pd-' + k).textContent = detail;
}

export function showOp(t, retrying = false) { $('#curOp').classList.remove('hidden'); $('#curOp').classList.toggle('retrying', !!retrying); $('#curOpText').textContent = t; }
export function hideOp() { $('#curOp').classList.add('hidden'); }
// The journal panel (features/journal.js, P32) replaced the old appendLog flat stream.
