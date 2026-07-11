// Content assistant modal: ops overview (dashboard read-model), the pending suggestion
// pool (persisted — a fresh "Gợi ý" run only adds ideas the pool doesn't already hold),
// full lifecycle history, and the production calendar. The owner PICKS: every accept or
// schedule passes through the pre-create config sheet — nothing auto-commits a paid pipeline.
import { $, $$, esc } from '../ui/dom.js';
import { api, withLock } from '../api.js';
import { toast } from '../ui/toast.js';
import { runSuggestionAction } from './assistant-sheet.js';
import { initHistoryTab, renderHistory } from './assistant-history.js';

let pool = []; // pending suggestion rows shown in the suggest tab

export function initAutopilot() {
  $('#heroAutopilot')?.addEventListener('click', openAutopilot);
  $('#apSuggest')?.addEventListener('click', () => withLock($('#apSuggest'), suggest));
  $('#apNiche')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') withLock($('#apSuggest'), suggest); });
  $('#apTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('.gtab');
    if (b) switchTab(b.dataset.tab);
  });
  $('#apTopics')?.addEventListener('click', onPoolAction);
  initHistoryTab();
  // cross-tab hooks: history's "🔁 similar" re-runs suggest; any decision refreshes the pool
  document.addEventListener('ap:resuggest', (e) => {
    const inp = $('#apNiche');
    if (inp) inp.value = e.detail || '';
    switchTab('suggest');
    withLock($('#apSuggest'), suggest);
  });
  document.addEventListener('ap:changed', () => { renderPool(); refreshOverview(); });
}

async function openAutopilot() {
  $('#autopilotModal').classList.add('open');
  switchTab('suggest');
  await Promise.all([refreshOverview(), renderPool()]);
}

function switchTab(tab) {
  $$('#apTabs .gtab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const panes = { suggest: '#apTabSuggest', history: '#apTabHistory', calendar: '#apTabCalendar' };
  Object.entries(panes).forEach(([k, sel]) => { const n = $(sel); if (n) n.style.display = k === tab ? 'block' : 'none'; });
  if (tab === 'history') renderHistory();
  if (tab === 'calendar') refreshOverview();
}

async function refreshOverview() {
  try {
    const d = await api.get('/dashboard');
    const st = d.projects.byStatus || {};
    const runningJobs = (d.jobs || []).filter((j) => j.status === 'running').length;
    const queuedJobs = (d.jobs || []).filter((j) => j.status === 'queued').length;
    const cost = (d.usage || []).reduce((a, u) => a + (u.estCost || 0), 0);
    $('#apStats').innerHTML = [
      chip('🎞 Video', d.projects.total),
      chip('✅ Hoàn thành', st.done || 0),
      chip('⚙️ Job chạy/chờ', `${runningJobs}/${queuedJobs}`),
      chip('💸 Chi phí ước tính', '$' + cost.toFixed(2)),
      chip('🗓 Lịch chờ', (d.calendar || []).length),
    ].join('');
    renderCalendar(await api.get('/calendar'));
  } catch (e) { toast('Lỗi tải tổng quan: ' + e.message, 'error'); }
}
function chip(label, val) {
  return `<div class="ap-chip"><b>${esc(String(val))}</b><span>${esc(label)}</span></div>`;
}

// ---- suggestion pool (pending rows from history — survives reloads) ----
async function renderPool() {
  const box = $('#apTopics');
  if (!box) return;
  try { ({ suggestions: pool } = await api.get('/topics/history?status=suggested&limit=30')); }
  catch (e) { box.innerHTML = `<div class="hint">✗ ${esc(e.message)}</div>`; return; }
  if (!pool.length) { box.innerHTML = '<div class="hint">Pool trống — bấm "Gợi ý" để trợ lý quét xu hướng và đề xuất chủ đề.</div>'; return; }
  box.innerHTML = pool.map((t) => {
    const score = t.score ? `<span class="as-score" title="${esc(t.score.why || '')}">🔥${t.score.viral ?? '–'} 🌲${t.score.evergreen ?? '–'} ⚙${t.score.difficulty ?? '–'}</span>` : '';
    return `<div class="ap-topic" data-id="${esc(t.id)}">
      <div style="flex:1;min-width:0">
        <div class="t">${esc(t.topic)} ${score}</div>
        ${t.angle || t.source ? `<div class="hint">${esc(t.angle || '')}${t.source ? `${t.angle ? ' · ' : ''}${esc(t.source)}` : ''}</div>` : ''}
      </div>
      <button class="btn sm" data-act="now" title="Chọn cấu hình rồi tạo ngay">▶ Làm ngay</button>
      <button class="btn sm" data-act="plan" title="Chọn cấu hình + thời điểm">🗓 Hẹn lịch</button>
      <button class="btn sm" data-act="dismiss" title="Bỏ qua (khôi phục được trong Lịch sử)">✕</button>
    </div>`;
  }).join('');
}

async function onPoolAction(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const row = pool.find((t) => t.id === b.closest('.ap-topic')?.dataset.id);
  if (!row) return;
  const changed = await runSuggestionAction(row, b.dataset.act);
  if (changed) { await renderPool(); refreshOverview(); }
}

async function suggest() {
  const note = $('#apSuggestNote');
  if (note) note.textContent = '⏳ Đang quét xu hướng + soạn gợi ý…';
  try {
    const r = await api.post('/topics/suggest', { niche: $('#apNiche').value.trim(), count: 8 });
    if (note) {
      note.textContent = r.topics.length
        ? `✓ Thêm ${r.topics.length} gợi ý mới (${r.source === 'llm' ? 'AI + xu hướng' : 'xu hướng thô — bật LLM để có góc tiếp cận & điểm số'})`
        : 'Không có gợi ý mới — mọi ý tưởng đã có trong pool/lịch sử hoặc trùng chủ đề cũ.';
    }
    await renderPool();
  } catch (e) { if (note) note.textContent = '✗ ' + e.message; }
}

function renderCalendar({ slots }) {
  const box = $('#apCalendar');
  if (!box) return;
  if (!slots?.length) { box.innerHTML = '<div class="hint">Chưa có lịch nào — hẹn từ một gợi ý ở tab 💡.</div>'; return; }
  box.innerHTML = slots.slice(-20).map((s) => `
    <div class="ap-slot">
      <span class="when">${new Date(s.due_at).toLocaleString('vi-VN')}</span>
      <span class="t" style="flex:1">${esc(s.topic)}</span>
      <span class="badge ${s.status === 'created' ? 'done' : s.status === 'cancelled' ? 'error' : 'paused'}">${s.status === 'queued' ? 'Chờ đến hạn' : s.status === 'created' ? 'Đã tạo video' : 'Đã huỷ'}</span>
      ${s.status === 'queued' ? `<button class="btn sm" data-del="${s.id}" title="Huỷ lịch (ý tưởng quay về pool)">✕</button>` : ''}
    </div>`).join('');
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api.del(`/calendar/${b.dataset.del}`);
    refreshOverview(); renderPool();
  }));
}
