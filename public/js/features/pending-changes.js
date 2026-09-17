// "2 thay đổi chưa áp dụng · ~90 giây · [Ghép lại]"
//
// The cost table (features/changeplan.js) has always been able to answer "what would this edit
// cost". The problem was reaching it. It sat behind three doors — the Resume button on a finished
// project, which silently becomes an apply button; a "dùng cho video này" button inside the
// subtitle panel; and a confirm dialog that only fires when a Brand Kit is SAVED. Change the
// transition style, the music bed, the master fade or the encoder in the config column and nothing
// anywhere said the finished video no longer matched its own settings.
//
// So the state becomes visible instead of hidden: edit anything in the config column of a finished
// project and a bar appears at the top of it saying what is pending and what it costs. It is one
// delegated listener, not a hook per control — a new setting inherits this for free, which is the
// property that made the three-door version drift in the first place.
//
// Rules it keeps, the same two the cost table keeps:
//   - A concat-only edit can be applied straight from the bar. It costs one join, spends no API
//     credit, and writes a NEW file, so there is nothing to undo.
//   - Anything that would re-render clips or re-voice scenes NEVER starts from here. That button
//     opens the cost table, because spending money is the owner's decision, not a side effect of
//     dragging a slider.
import { $ } from '../ui/dom.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { m, tp } from '../i18n.js';
import { gatherConfig } from '../views/config.js';
import { openChangePlan } from './changeplan.js';
import { showJournal } from './journal.js';
import { fmtApprox } from '../ui/format.js';

const SETTLE_MS = 550; // long enough that dragging a slider is one question, not forty


let timer = 0;
let seq = 0;         // a slow answer to an old question must never overwrite a fresh one
let lastSent = null; // the config the last answer describes
let busy = false;

/** Only a finished video can be out of date with its own settings. */
function eligible() {
  const p = state.current;
  return !!(p?.id && p.video_path && !['running', 'queued'].includes(p.status));
}

function paint(plan) {
  const bar = $('#pendingBar');
  if (!bar) return;
  if (!plan || !plan.items?.length) { bar.classList.add('hidden'); return; }
  const heavy = plan.items.filter((i) => i.kind !== 'concat');
  const costly = plan.items.some((i) => i.costly);
  const n = plan.items.length;
  bar.classList.remove('hidden');
  bar.classList.toggle('heavy', !!heavy.length);
  // The summary names the WORK, not the settings: "render lại 46 cảnh" is the number that decides
  // whether the owner presses the button.
  bar.querySelector('[data-pc-text]').innerHTML =
    `<b>${tp`${n} thay đổi chưa áp dụng`}</b> · ${fmtApprox(plan.totalSec)}`
    + `<span class="pc-why">${plan.items.map((i) => i.label).join(' · ')}</span>`
    + (costly ? `<span class="pc-warn">${m('⚠ có bước lồng tiếng lại — tốn tiền API')}</span>` : '');
  const go = bar.querySelector('[data-pc-go]');
  go.textContent = plan.concatOnly ? tp`🔗 Ghép lại (${fmtApprox(plan.totalSec)})` : m('Xem chi phí…');
  go.classList.toggle('primary', plan.concatOnly);
  go.disabled = busy;
  bar.dataset.mode = plan.concatOnly ? 'join' : 'plan';
}

/** Ask the server what is pending. Cheap: hashes and DB rows, no ffmpeg. */
async function refresh() {
  if (!eligible()) { paint(null); return; }
  const config = gatherConfig();
  const key = JSON.stringify(config);
  if (key === lastSent) return; // the panel fired, but nothing in it actually moved
  const mine = ++seq;
  const forProject = state.current.id;
  try {
    const plan = await api.post(`/projects/${forProject}/plan-changes`, { config });
    // Two ways this answer can be stale by the time it lands, and both have to lose: the owner kept
    // typing, or they opened a different project while it was in flight.
    if (mine !== seq || state.current?.id !== forProject) return;
    lastSent = key;
    paint(plan);
  } catch {
    // A pending-changes bar that cannot answer says nothing at all — it is an affordance, not a
    // result, and a red toast every time a slider moves would be worse than the silence it replaces.
    if (mine === seq) paint(null);
  }
}

/** Re-ask after the panel settles. Safe to call from anywhere, as often as you like. */
export function schedulePendingCheck({ now = false } = {}) {
  clearTimeout(timer);
  if (now) lastSent = null; // an external edit (Brand Kit, subtitle preset) changes what we compare against
  timer = setTimeout(refresh, now ? 0 : SETTLE_MS);
}

/** The project changed underneath us — forget the previous answer entirely. */
export function resetPendingCheck() {
  clearTimeout(timer);
  seq++; // orphan whatever is in flight
  lastSent = null;
  busy = false;
  paint(null);
  schedulePendingCheck();
}

export function initPendingChanges() {
  const bar = $('#pendingBar');
  const col = $('#sConfig');
  if (!bar || !col) return;
  // ONE listener for the whole config column. Every control in it — and every control added to it
  // later — reports through this, which is the difference between a feature and a list of hooks
  // somebody has to remember to extend.
  for (const ev of ['change', 'input']) col.addEventListener(ev, () => schedulePendingCheck(), true);
  // The group being edited is MOVED into #cfgModal, outside the column, so its edits never reached
  // the listener above and the bar only caught up on the next status event.
  const modal = $('#cfgModal');
  if (modal) for (const ev of ['change', 'input']) modal.addEventListener(ev, () => schedulePendingCheck(), true);

  bar.querySelector('[data-pc-go]').addEventListener('click', async () => {
    if (bar.dataset.mode !== 'join') { openChangePlan(); return; }
    const go = bar.querySelector('[data-pc-go]');
    busy = true; go.disabled = true;
    const was = go.textContent;
    go.textContent = m('⏳ Đang ghép…');
    try {
      const r = await api.post(`/projects/${state.current.id}/apply-changes`, { config: gatherConfig() });
      if (!r?.started) { toast('Không có gì để ghép lại', 'success'); bar.classList.add('hidden'); return; }
      toast('🔗 Đang ghép lại video với thiết lập mới', 'success');
      showJournal(); // it is a long step and it is already live on the websocket
    } catch (e) {
      toast(`✖ ${e.message}`, 'error');
      go.textContent = was;
    } finally {
      busy = false; go.disabled = false;
    }
  });
  bar.querySelector('[data-pc-detail]').addEventListener('click', () => openChangePlan());
}
