// The live feed: one WebSocket, the per-project subscription, and every progress event applied to the view.
import { $, badgeText, statusIcon } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api, WS } from '../../api.js';
import { state } from '../../state.js';
import { PIPE, PHASE_W, PHASE_ORDER, prog, setProgress, recomputeProgress, setStep, showOp, hideOp } from '../progress.js';
import { onJournalEvent } from '../../features/journal.js';
import { refreshScenes, onSceneUpdate, flushSceneUpdates } from '../scenes.js';
import { icon } from '../../ui/icons.js';
import { schedulePendingCheck } from '../../features/pending-changes.js';
import { m, tp } from '../../i18n.js';
import { loadProjects } from './projects.js';
import { renderProjectView, renderSceneGate } from './project-view.js';

let ws = null;

export function initWs() { ws = new WS(onWsMessage); }
/** Follow one project's live feed (and replay its buffered events). */
export function subscribeWs(id) { ws?.subscribe(id); }

// ---------------- WS ----------------
function onWsMessage(ev) {
  if (ev.type === '_status') { state.wsOpen = ev.open; $('#wsDot').textContent = ev.open ? m('● realtime') : m('● offline'); $('#wsDot').classList.toggle('on', ev.open); return; }
  // cross-project broadcasts (before the current-project filter)
  if (ev.type === 'job') { document.dispatchEvent(new CustomEvent('ws:job', { detail: ev })); return; }
  if (!state.current || (ev.projectId && ev.projectId !== state.current.id)) return;
  if (ev.type === 'replay') {
    // buffered feed replayed on (re)subscribe: a page reload mid-run catches up instantly.
    // 'op' spam is skipped except the last one (only the current activity line matters).
    const events = ev.events || [];
    const lastOp = events.map((e, i) => (e.type === 'op' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    events.forEach((e, i) => { if (e.type !== 'op' || i === lastOp) onWsMessage(e); });
    return;
  }
  switch (ev.type) {
    case 'step':
      flushSceneUpdates(); // coalesced patches must land before step transitions
      setStep(ev.step, ev.state, ev.detail);
      if (ev.state === 'running') { showOp(PIPE.find((x) => x.k === ev.step)?.n || ''); prog.step = ev.step; recomputeProgress(); }
      else if (ev.state === 'done') {
        const i = PHASE_ORDER.indexOf(ev.step);
        if (i >= 0) setProgress(PHASE_ORDER.slice(0, i + 1).reduce((s, k) => s + PHASE_W[k], 0));
        if (ev.step === 'b2') { prog.total = parseInt(ev.detail) || prog.total; refreshScenes(); }
      }
      break;
    case 'op': showOp(ev.text); break;
    case 'journal': onJournalEvent(ev); break;
    case 'status': flushSceneUpdates(); updateStatusBadge(ev.status); break;
    case 'scene': onSceneUpdate(ev); break;
    case 'retry': onRetryEvent(ev); break;
    case 'done': flushSceneUpdates(); onDone(ev); break;
    case 'error':
      flushSceneUpdates();
      toast(tp`Lỗi: ${ev.msg}`, 'error'); hideOp(); updateStatusBadge('error');
      if (prog.step) setStep(prog.step, 'error', (ev.msg || '').slice(0, 60));
      break;
    // content calendar lifecycle (assistant-scheduled videos)
    case 'calendar':
      toast(tp`🗓 Đến hạn — bắt đầu sản xuất: ${(ev.topic || '').slice(0, 60)}`, 'success');
      loadProjects();
      break;
    case 'calendar-done':
      toast(ev.status === 'done'
        ? tp`✅ Video hẹn lịch đã xong: ${(ev.topic || '').slice(0, 60)}`
        : tp`⚠ Video hẹn lịch kết thúc (${ev.status}): ${(ev.topic || '').slice(0, 60)}`, ev.status === 'done' ? 'success' : 'error');
      loadProjects();
      break;
  }
}
// Self-heal visibility: 'đang tự thử lại' — the user sees the app fixing itself, not a stall.
function onRetryEvent(ev) {
  const label = ev.scope === 'pipeline'
    ? tp`🩹 Gặp lỗi "${(ev.msg || '').slice(0, 70)}" — tự động chạy tiếp sau ${Math.round((ev.delayMs || 8000) / 1000)}s…`
    : `🩹 ${ev.idx != null ? tp`Cảnh ${ev.idx + 1}: ` : ''}${m('đang tự thử lại')}${ev.attempt ? tp` (lần ${ev.attempt + 1})` : ''}…`;
  showOp(label, true);
  if (ev.step) setStep(ev.step, 'running', m('🩹 tự thử lại…'));
  if (ev.idx != null) {
    const sc = state.scenes.find((s) => s.idx === ev.idx);
    if (sc) { sc.status = 'retrying'; const cEl = document.querySelector(`#sceneGrid .scene[data-id="${sc.id}"] .n span:last-child`); if (cEl) cEl.textContent = statusIcon('retrying'); }
  }
}
function updateStatusBadge(status) {
  if (state.current) state.current.status = status;
  // The bar is a claim about a FINISHED file. A run starting invalidates it, and a run finishing
  // is the moment it should have emptied — without this it kept advertising work already done.
  schedulePendingCheck({ now: true });
  $('#pvStatus').textContent = badgeText(status); $('#pvStatus').className = 'badge ' + status;
  $('#btnStop').classList.toggle('hidden', status !== 'running');
  // 'review' included: a live WS hold must reveal the continue button without a reload
  $('#btnResume').classList.toggle('hidden', !['paused', 'error', 'review', 'done'].includes(status));
  $('#btnResume').innerHTML = status === 'done'
    ? `${icon('refresh', 14)} ${m('Áp dụng thay đổi')}`
    : `${icon('play', 14)} ${m('Tiếp tục')}`;
  renderSceneGate(state.current);
}
async function onDone(ev) {
  hideOp(); setProgress(100); toast('Video hoàn thành ✓', 'success');
  const r = await api.get('/projects/' + state.current.id);
  state.current = r.project; state.scenes = r.scenes;
  renderProjectView();
  setProgress(100);
  loadProjects();
}
