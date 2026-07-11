// Suggestion history tab — the full lifecycle ledger of everything the assistant ever
// proposed: browse/filter/search, restore dismissed ideas, jump to created videos, or
// re-run a suggestion as a new niche. Actions delegate to the shared config sheet.
import { $, esc } from '../ui/dom.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { closeModal } from '../ui/modals.js';
import { openProject } from '../views/studio.js';
import { runSuggestionAction } from './assistant-sheet.js';

const STATUS_BADGE = {
  suggested: ['paused', 'Đang chờ'],
  accepted: ['done', 'Đã tạo video'],
  scheduled: ['paused', 'Đã hẹn lịch'],
  dismissed: ['error', 'Đã bỏ qua'],
  expired: ['error', 'Hết hạn'],
};

let wired = false;
let rows = [];

export function initHistoryTab() {
  if (wired) return;
  wired = true;
  let deb;
  $('#apHistQ')?.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(renderHistory, 250); });
  $('#apHistStatus')?.addEventListener('change', renderHistory);
  $('#apHistAll')?.addEventListener('change', renderHistory);
  $('#apHistory')?.addEventListener('click', onRowAction);
}

export async function renderHistory() {
  const box = $('#apHistory');
  if (!box) return;
  const params = new URLSearchParams();
  const st = $('#apHistStatus')?.value;
  if (st) params.set('status', st);
  const q = $('#apHistQ')?.value.trim();
  if (q) params.set('q', q);
  if ($('#apHistAll')?.checked) params.set('all', '1');
  try {
    ({ suggestions: rows } = await api.get(`/topics/history?${params}`));
  } catch (e) { box.innerHTML = `<div class="hint">✗ ${esc(e.message)}</div>`; return; }
  if (!rows.length) { box.innerHTML = '<div class="hint">Chưa có mục nào khớp bộ lọc.</div>'; return; }
  box.innerHTML = rows.map((r) => {
    const [cls, label] = STATUS_BADGE[r.status] || ['paused', r.status];
    const when = new Date(r.created_at).toLocaleDateString('vi-VN');
    const score = r.score ? `<span class="as-score" title="${esc(r.score.why || '')}">🔥${r.score.viral ?? '–'} 🌲${r.score.evergreen ?? '–'} ⚙${r.score.difficulty ?? '–'}</span>` : '';
    const acts = [];
    if (r.status === 'suggested') acts.push(btn(r.id, 'now', '▶'), btn(r.id, 'plan', '🗓'), btn(r.id, 'dismiss', '✕'));
    if (r.status === 'dismissed' || r.status === 'expired') acts.push(btn(r.id, 'restore', '↩ Khôi phục'));
    if (r.project_id) acts.push(btn(r.id, 'open', '🎬 Mở video'));
    acts.push(btn(r.id, 'similar', '🔁'));
    return `<div class="ap-hist" data-id="${esc(r.id)}">
      <div class="ap-hist-main">
        <div class="t">${esc(r.topic)} ${score}</div>
        <div class="hint">${esc(when)}${r.angle ? ` · ${esc(r.angle)}` : ''}${r.niche ? ` · ngách: ${esc(r.niche)}` : ''}</div>
      </div>
      <span class="badge ${cls}">${label}</span>
      <span class="ap-hist-acts">${acts.join('')}</span>
    </div>`;
  }).join('');
}

function btn(id, act, label) {
  const titles = { now: 'Tạo video ngay', plan: 'Hẹn lịch', dismiss: 'Bỏ qua', similar: 'Gợi ý tương tự' };
  return `<button class="btn sm" data-act="${act}" title="${titles[act] || ''}">${label}</button>`;
}

async function onRowAction(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const rowEl = b.closest('.ap-hist');
  const row = rows.find((r) => r.id === rowEl?.dataset.id);
  if (!row) return;
  const act = b.dataset.act;
  if (act === 'open') {
    closeModal($('#autopilotModal'));
    try { await openProject(row.project_id); } catch (err) { toast('✗ ' + err.message, 'error'); }
    return;
  }
  if (act === 'similar') {
    document.dispatchEvent(new CustomEvent('ap:resuggest', { detail: row.topic }));
    return;
  }
  const changed = await runSuggestionAction(row, act);
  if (changed) {
    await renderHistory();
    document.dispatchEvent(new CustomEvent('ap:changed'));
  }
}
