// Content assistant modal: ops overview (dashboard read-model), the pending suggestion
// pool (persisted — a fresh "Gợi ý" run only adds ideas the pool doesn't already hold),
// full lifecycle history, and the production calendar. The owner PICKS: every accept or
// schedule passes through the pre-create config sheet — nothing auto-commits a paid pipeline.
import { $, $$, esc } from '../ui/dom.js';
import { api, withLock } from '../api.js';
import { toast } from '../ui/toast.js';
import { menuDialog, confirmDialog } from '../ui/dialog.js';
import { state } from '../state.js';
import { gatherConfig } from '../views/config.js';
import {
  runSuggestionAction, slotConfigSheet, slotTimeDialog, planWeekDialog,
  addRecurrenceDialog, channelAssistant, configSheet,
} from './assistant-sheet.js';
import { initHistoryTab, renderHistory } from './assistant-history.js';

const PACK_LABELS = { 'vn-news': '📰 Tin tức VN', 'vn-tech': '💻 Công nghệ VN', 'vn-business': '📈 Kinh doanh VN' };

let pool = []; // pending suggestion rows shown in the suggest tab
let recs = []; // fixed weekly production windows (templates)
let sourcesLoaded = false;

export function initAutopilot() {
  $('#heroAutopilot')?.addEventListener('click', openAutopilot);
  $('#apSuggest')?.addEventListener('click', () => withLock($('#apSuggest'), suggest));
  $('#apNiche')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') withLock($('#apSuggest'), suggest); });
  $('#apTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('.gtab');
    if (b) switchTab(b.dataset.tab);
  });
  $('#apTopics')?.addEventListener('click', onPoolAction);
  $('#apSaveSources')?.addEventListener('click', () => withLock($('#apSaveSources'), saveSources));
  $('#apPlanWeek')?.addEventListener('click', async () => {
    if (await planWeekDialog({ times: preferredTimes() })) { refreshOverview(); renderPool(); }
  });
  $('#apAddRec')?.addEventListener('click', async () => { if (await addRecurrenceDialog()) renderRecs(); });
  $('#apRecs')?.addEventListener('click', onRecAction);
  $('#apPrefSave')?.addEventListener('click', () => withLock($('#apPrefSave'), savePrefs));
  $('#apPrefCfgSave')?.addEventListener('click', () => withLock($('#apPrefCfgSave'), () => saveAssistantConfig(gatherConfig())));
  $('#apPrefCfgClear')?.addEventListener('click', () => withLock($('#apPrefCfgClear'), () => saveAssistantConfig(null)));
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
  loadPrefs();
  await Promise.all([refreshOverview(), renderPool(), loadSources(), renderRecs()]);
}

// ---- per-channel assistant preferences (channel.config.assistant — no secrets) ----
function preferredTimes() {
  const recTimes = (recs || []).map((r) => r.time);
  const pref = channelAssistant()?.preferredTimes || [];
  const merged = [...new Set([...recTimes, ...pref])];
  return merged.length ? merged : null;
}

function loadPrefs() {
  const a = channelAssistant() || {};
  const niche = $('#apNiche');
  if (niche && !niche.value.trim() && a.niche) niche.value = a.niche;
  if ($('#apPrefNiche')) $('#apPrefNiche').value = a.niche || '';
  if ($('#apPrefTimes')) $('#apPrefTimes').value = (a.preferredTimes || []).join(', ');
  if ($('#apPrefCfgState')) {
    $('#apPrefCfgState').textContent = a.defaultConfig
      ? `✓ Đã có config trợ lý (${a.defaultConfig.visualMode || 'hyperframe'} · ${a.defaultConfig.aspectRatio || 'theo kênh'})`
      : 'Chưa có config trợ lý riêng — video từ trợ lý dùng mặc định kênh.';
  }
}

async function putChannelAssistant(patch) {
  if (!state.activeChannel) { toast('Chưa có kênh đang hoạt động.', 'error'); return false; }
  try {
    const { channel } = await api.put(`/channels/${state.activeChannel}`, { config: { assistant: patch } });
    const i = (state.channels || []).findIndex((c) => c.id === channel.id);
    if (i >= 0) state.channels[i] = channel;
    return true;
  } catch (e) { toast('✗ ' + e.message, 'error'); return false; }
}

async function savePrefs() {
  const times = $('#apPrefTimes').value.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
  if (await putChannelAssistant({ niche: $('#apPrefNiche').value.trim(), preferredTimes: times })) {
    toast('💾 Đã lưu cài đặt trợ lý của kênh.', 'success');
    loadPrefs();
  }
}

async function saveAssistantConfig(config) {
  if (await putChannelAssistant({ defaultConfig: config })) {
    toast(config ? '📋 Panel Studio hiện tại đã thành config trợ lý của kênh.' : '🗑 Đã xoá config trợ lý.', 'success');
    loadPrefs();
  }
}

// ---- trend source preferences (packs + custom feeds) ----
async function loadSources() {
  if (sourcesLoaded) return;
  try {
    const { assistant } = await api.get('/assistant/settings');
    const packs = new Set(assistant.packs || []);
    $('#apPacks').innerHTML = Object.entries(PACK_LABELS).map(([id, label]) =>
      `<label class="hint" style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" data-pack="${id}" ${packs.has(id) ? 'checked' : ''}> ${label}</label>`).join('');
    $('#apFeeds').value = (assistant.feeds || []).map((f) => f.url).join('\n');
    sourcesLoaded = true;
  } catch { /* the disclosure just stays empty */ }
}

async function saveSources() {
  const packs = [...$('#apPacks').querySelectorAll('[data-pack]:checked')].map((n) => n.dataset.pack);
  const feeds = $('#apFeeds').value.split('\n').map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u))
    .map((url) => ({ url }));
  try {
    await api.put('/assistant/settings', { packs, feeds });
    toast('💾 Đã lưu nguồn xu hướng.', 'success');
  } catch (e) { toast('✗ ' + e.message, 'error'); }
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
    const f = d.funnel || {};
    const next = (d.upcoming || [])[0];
    $('#apStats').innerHTML = [
      chip('🎞 Video', d.projects.total),
      chip('✅ Hoàn thành', st.done || 0),
      chip('⚙️ Job chạy/chờ', `${runningJobs}/${queuedJobs}`),
      chip('💸 Chi phí ước tính', '$' + cost.toFixed(2)),
      chip('💡 Gợi ý 30 ngày', `${f.accepted || 0}+${f.scheduled || 0}/${(f.suggested || 0) + (f.accepted || 0) + (f.scheduled || 0) + (f.dismissed || 0)}`,
        'đã dùng + đã hẹn / tổng gợi ý'),
      next ? chip('⏭ Slot kế tiếp', nextIn(next.due_at), next.topic) : chip('🗓 Lịch chờ', (d.calendar || []).length),
      d.week ? sparkChip(d.week) : '',
    ].join('');
    renderCalendar(await api.get('/calendar'));
  } catch (e) { toast('Lỗi tải tổng quan: ' + e.message, 'error'); }
}
function chip(label, val, title = '') {
  return `<div class="ap-chip" ${title ? `title="${esc(title)}"` : ''}><b>${esc(String(val))}</b><span>${esc(label)}</span></div>`;
}
function nextIn(dueAt) {
  const mins = Math.max(0, Math.round((dueAt - Date.now()) / 60000));
  if (mins < 60) return `${mins} phút`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} giờ`;
  return `${Math.round(mins / 1440)} ngày`;
}
// 7-day created/done sparkline — inline SVG, no library
function sparkChip(week) {
  const max = Math.max(1, ...week.createdByDay, ...week.doneByDay);
  const pts = (arr) => arr.map((v, i) => `${6 + i * 14},${26 - (v / max) * 20}`).join(' ');
  return `<div class="ap-chip" title="7 ngày: tạo (mờ) / hoàn thành (đậm)">
    <svg width="96" height="28" viewBox="0 0 96 28" aria-hidden="true">
      <polyline points="${pts(week.createdByDay)}" fill="none" stroke="rgba(124,140,255,.45)" stroke-width="2"/>
      <polyline points="${pts(week.doneByDay)}" fill="none" stroke="#7C8CFF" stroke-width="2"/>
    </svg><span>📈 Nhịp 7 ngày</span></div>`;
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
    // pending ideas silently expire after 14 days — surface the countdown near the end (P34)
    const daysLeft = 14 - Math.floor((Date.now() - (t.created_at || Date.now())) / 86400000);
    const expiry = daysLeft <= 3 ? `<span class="as-score" style="color:#fbbf24" title="Gợi ý chờ quá 14 ngày sẽ tự hết hạn">⏳ còn ${Math.max(0, daysLeft)} ngày</span>` : '';
    return `<div class="ap-topic" data-id="${esc(t.id)}">
      <div style="flex:1;min-width:0">
        <div class="t">${esc(t.topic)} ${score} ${expiry}</div>
        ${t.angle || t.source ? `<div class="hint">${esc(t.angle || '')}${t.source ? `${t.angle ? ' · ' : ''}${esc(t.source)}` : ''}</div>` : ''}
      </div>
      <button class="btn sm" data-act="now" title="Chọn cấu hình rồi tạo ngay">▶ Làm ngay</button>
      <button class="btn sm" data-act="plan" title="Chọn cấu hình + thời điểm">🗓 Hẹn lịch</button>
      <button class="btn sm" data-act="series" title="Phát triển thành mini-series nhiều tập">📚</button>
      <button class="btn sm" data-act="dismiss" title="Bỏ qua (khôi phục được trong Lịch sử)">✕</button>
    </div>`;
  }).join('');
}

async function onPoolAction(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const row = pool.find((t) => t.id === b.closest('.ap-topic')?.dataset.id);
  if (!row) return;
  if (b.dataset.act === 'series') { await seriesFlow(row); return; }
  const changed = await runSuggestionAction(row, b.dataset.act);
  if (changed) { await renderPool(); refreshOverview(); }
}

// ---- mini-series: LLM designs N connected episodes → pending suggestions ----
async function seriesFlow(row) {
  const n = await menuDialog({
    title: `📚 Lên series từ: ${row.topic.slice(0, 60)}`,
    items: [
      { id: '3', label: '3 tập (gọn)' },
      { id: '5', label: '5 tập (chuẩn)' },
      { id: '7', label: '7 tập (sâu)' },
    ],
  });
  if (!n) return;
  const note = $('#apSuggestNote');
  if (note) note.textContent = '⏳ AI đang thiết kế series…';
  try {
    const r = await api.post('/topics/series', { suggestionId: row.id, episodes: +n });
    if (note) note.textContent = `✓ Series "${r.series.name}" — ${r.suggestions.length} tập đã vào pool.`;
    await renderPool();
    refreshOverview();
    const times = preferredTimes() || ['08:00'];
    if (await confirmDialog({
      title: 'Xếp lịch cả series?',
      body: `${r.suggestions.length} tập, mỗi ngày 1 tập lúc ${times[0]}, bắt đầu từ ngày mai.`,
      okText: '🗓 Xếp lịch',
    })) {
      // P34: the series episodes get a REVIEWED config too (one sheet, applied to every
      // episode) — before this they were scheduled with no config at all
      const picked = await configSheet({ row: { topic: `📚 ${r.series.name} (áp cho mọi tập)` }, mode: 'edit' });
      const p = await api.post('/calendar/plan', {
        topicIds: r.suggestions.map((s) => s.id),
        days: r.suggestions.length + 1, perDay: 1, times: [times[0]],
        config: picked?.config || {},
      });
      toast(`📅 Đã xếp ${p.planned} tập vào lịch.`, 'success');
      renderPool(); refreshOverview();
    }
  } catch (e) { if (note) note.textContent = '✗ ' + e.message; }
}

// ---- fixed weekly windows (recurrences) ----
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function nextOccurrence(rec) {
  const [hh, mm] = rec.time.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(hh, mm || 0, 0, 0);
  let add = (rec.weekday - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() <= Date.now()) add = 7;
  d.setDate(d.getDate() + add);
  return d.getTime();
}

async function renderRecs() {
  const box = $('#apRecs');
  if (!box) return;
  try { ({ recurrences: recs } = await api.get('/calendar/recurrences')); }
  catch { recs = []; }
  if (!recs.length) { box.innerHTML = '<div class="hint">Chưa có khung giờ cố định nào.</div>'; return; }
  box.innerHTML = recs.map((r) => `
    <div class="ap-slot" data-id="${esc(r.id)}">
      <span class="when">${WEEKDAYS[r.weekday]} · ${esc(r.time)}</span>
      <span class="t hint" style="flex:1">kế tiếp: ${new Date(nextOccurrence(r)).toLocaleString('vi-VN')}</span>
      <button class="btn sm" data-rec="fill">＋ Chọn chủ đề</button>
      <button class="btn sm" data-rec="del" title="Xoá khung giờ">✕</button>
    </div>`).join('');
}

async function onRecAction(e) {
  const b = e.target.closest('button[data-rec]');
  if (!b) return;
  const rec = recs.find((r) => r.id === b.closest('.ap-slot')?.dataset.id);
  if (!rec) return;
  if (b.dataset.rec === 'del') {
    await api.del(`/calendar/recurrences/${rec.id}`);
    renderRecs();
    return;
  }
  // fill the window: pick a pending suggestion, then the usual schedule sheet prefilled
  if (!pool.length) await renderPool();
  if (!pool.length) { toast('Pool trống — tạo gợi ý ở tab 💡 trước đã.', 'error'); return; }
  const pick = await menuDialog({
    title: `＋ Chủ đề cho ${WEEKDAYS[rec.weekday]} · ${rec.time}`,
    items: pool.slice(0, 8).map((t) => ({ id: t.id, label: t.topic.slice(0, 70) })),
  });
  if (!pick) return;
  const row = pool.find((t) => t.id === pick);
  const changed = await runSuggestionAction(row, 'plan', { due: nextOccurrence(rec) });
  if (changed) { renderPool(); refreshOverview(); }
}

async function suggest() {
  const note = $('#apSuggestNote');
  if (note) note.textContent = '⏳ Đang quét xu hướng + soạn gợi ý…';
  try {
    const count = parseInt($('#apCount')?.value, 10) || 8;
    const r = await api.post('/topics/suggest', { niche: $('#apNiche').value.trim(), count });
    if (note) {
      // honest sourcing (P34): "AI + xu hướng" only when trend signals actually arrived
      const src = r.source === 'llm'
        ? (r.trends ? `AI + ${r.trends} tín hiệu xu hướng` : 'AI thuần — không lấy được nguồn xu hướng nào (mạng/feed lỗi)')
        : 'xu hướng thô — bật LLM để có góc tiếp cận & điểm số';
      note.textContent = r.topics.length
        ? `✓ Thêm ${r.topics.length} gợi ý mới (${src})`
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
    <div class="ap-slot" data-id="${esc(s.id)}">
      <span class="when">${new Date(s.due_at).toLocaleString('vi-VN')}</span>
      <span class="t" style="flex:1">${esc(s.topic)}</span>
      <span class="badge ${s.status === 'created' ? 'done' : s.status === 'cancelled' ? 'error' : 'paused'}">${s.status === 'queued' ? 'Chờ đến hạn' : s.status === 'created' ? 'Đã tạo video' : 'Đã huỷ'}</span>
      ${s.status === 'queued' ? `
      <button class="btn sm" data-slot="cfg" title="Sửa cấu hình slot">⚙</button>
      <button class="btn sm" data-slot="time" title="Dời lịch">🕐</button>
      <button class="btn sm" data-slot="del" title="Huỷ lịch (ý tưởng quay về pool)">✕</button>` : ''}
    </div>`).join('');
  box.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', async () => {
    const slot = slots.find((s) => s.id === b.closest('.ap-slot')?.dataset.id);
    if (!slot) return;
    const act = b.dataset.slot;
    if (act === 'del') { await api.del(`/calendar/${slot.id}`); refreshOverview(); renderPool(); return; }
    const changed = act === 'cfg' ? await slotConfigSheet(slot) : await slotTimeDialog(slot);
    if (changed) refreshOverview();
  }));
}
