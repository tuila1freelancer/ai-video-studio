// Content assistant modal: ops overview (dashboard read-model), trend-based topic
// suggestions (owner PICKS — nothing auto-commits a paid pipeline), and the production
// calendar (due slots become videos on the scheduler tick).
import { $, el, esc, badgeText } from '../ui/dom.js';
import { api, withLock } from '../api.js';
import { toast } from '../ui/toast.js';
import { promptDialog, confirmDialog } from '../ui/dialog.js';

export function initAutopilot() {
  $('#heroAutopilot')?.addEventListener('click', openAutopilot);
  $('#apSuggest')?.addEventListener('click', () => withLock($('#apSuggest'), suggest));
}

async function openAutopilot() {
  $('#autopilotModal').classList.add('open');
  $('#apTopics').innerHTML = '';
  await refresh();
}

async function refresh() {
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

async function suggest() {
  const box = $('#apTopics');
  box.innerHTML = '<div class="hint">⏳ Đang quét xu hướng + soạn gợi ý…</div>';
  try {
    const r = await api.post('/topics/suggest', { niche: $('#apNiche').value.trim(), count: 8 });
    if (!r.topics.length) { box.innerHTML = '<div class="hint">Không có gợi ý mới (mọi thứ đã trùng chủ đề cũ).</div>'; return; }
    box.innerHTML = r.topics.map((t, i) => `
      <div class="ap-topic" data-i="${i}">
        <div style="flex:1;min-width:0">
          <div class="t">${esc(t.topic)}</div>
          ${t.angle ? `<div class="hint">${esc(t.angle)}${t.source ? ` · ${esc(t.source)}` : ''}</div>` : ''}
        </div>
        <button class="btn sm" data-act="now">▶ Làm ngay</button>
        <button class="btn sm" data-act="plan">🗓 Hẹn lịch</button>
      </div>`).join('');
    box.querySelectorAll('.ap-topic').forEach((row) => row.addEventListener('click', async (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      const topic = r.topics[+row.dataset.i].topic;
      if (btn.dataset.act === 'now') {
        const ok = await confirmDialog({ title: 'Tạo video ngay?', body: topic, okText: 'Chạy pipeline' });
        if (!ok) return;
        await api.post('/batch', { topics: [topic] });
        toast('Đã đưa vào hàng đợi sản xuất 🎬', 'success');
      } else {
        const when = await promptDialog({ title: 'Hẹn lịch sản xuất', label: 'Thời điểm (YYYY-MM-DD HH:mm)', value: defaultDue(), okText: 'Hẹn' });
        if (!when) return;
        const dueAt = Date.parse(when.replace(' ', 'T'));
        if (!Number.isFinite(dueAt)) { toast('Định dạng thời gian không hợp lệ.', 'error'); return; }
        await api.post('/calendar', { topic, dueAt });
        toast('Đã hẹn lịch 🗓', 'success');
        refresh();
      }
    }));
  } catch (e) { box.innerHTML = `<div class="hint">✗ ${esc(e.message)}</div>`; }
}
function defaultDue() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 08:00`;
}

function renderCalendar({ slots }) {
  const box = $('#apCalendar');
  if (!slots?.length) { box.innerHTML = '<div class="hint">Chưa có lịch nào — hẹn từ một gợi ý phía trên.</div>'; return; }
  box.innerHTML = slots.slice(-20).map((s) => `
    <div class="ap-slot">
      <span class="when">${new Date(s.due_at).toLocaleString('vi-VN')}</span>
      <span class="t" style="flex:1">${esc(s.topic)}</span>
      <span class="badge ${s.status === 'created' ? 'done' : s.status === 'cancelled' ? 'error' : 'paused'}">${s.status === 'queued' ? 'Chờ đến hạn' : s.status === 'created' ? 'Đã tạo video' : 'Đã huỷ'}</span>
      ${s.status === 'queued' ? `<button class="btn sm" data-del="${s.id}">✕</button>` : ''}
    </div>`).join('');
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api.del(`/calendar/${b.dataset.del}`);
    refresh();
  }));
}
