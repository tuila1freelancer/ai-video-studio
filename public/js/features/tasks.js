// Global tasks view ("🗂 Tác vụ") — every queued/running/recent job across ALL projects,
// backed by the durable jobs ledger + the P32 system lane. The journal answers "what
// happened in THIS project"; this view answers "what is the app doing right now, anywhere".
import { $, el, esc } from '../ui/dom.js';
import { api } from '../api.js';
import { openProject } from '../views/studio.js';
import { closeModal } from '../ui/modals.js';
import { fmtMs } from './journal.js';
import { m } from '../i18n.js';

// Built on call, not at import: the catalogue is fetched after this module is evaluated.
const kindLabel = () => ({ pipeline: m('🎬 Sản xuất video'), render: m('🎞 Render') });
const statusLabel = () => ({ queued: m('⏳ đang chờ'), running: m('▶ đang chạy'), done: m('✅ xong'), error: m('⛔ lỗi'), cancelled: m('🚫 huỷ') });

export function initTasks() {
  $('#heroTasks')?.addEventListener('click', async () => {
    $('#tasksModal').classList.add('open');
    await refreshTasks();
  });
  $('#tasksRefresh')?.addEventListener('click', refreshTasks);
}

let busy = false;
export async function refreshTasks() {
  if (busy || !$('#tasksModal')?.classList.contains('open')) return;
  busy = true;
  try {
    const { jobs = [], sys = [] } = await api.get('/tasks');
    const box = $('#tasksList'); box.innerHTML = '';
    const kinds = kindLabel(); const status = statusLabel();
    if (!jobs.length) box.appendChild(el('div', 'empty', m('Chưa có tác vụ nào.')));
    for (const j of jobs) {
      const cls = j.status || '';
      const dur = j.started_at ? fmtMs((j.finished_at || Date.now()) - j.started_at) : '';
      const row = el('div', 'task-row');
      row.innerHTML = `<span class="tk">${kinds[j.kind] || esc(j.kind)}</span>
        <span class="tt">${esc(j.projectTitle || j.project_id || '—')}</span>
        <span class="badge ${esc(cls)}">${status[j.status] || esc(j.status)}</span>
        <span class="td">${j.attempts > 1 ? `↻${j.attempts} · ` : ''}${new Date(j.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}${dur ? ' · ' + dur : ''}</span>`;
      if (j.project_id) {
        row.classList.add('click');
        row.title = m('Mở dự án + nhật ký của lần chạy này');
        row.addEventListener('click', () => { closeModal('#tasksModal'); openProject(j.project_id); });
      }
      box.appendChild(row);
    }
    const sysBox = $('#tasksSys'); sysBox.innerHTML = '';
    if (sys.length) {
      sysBox.appendChild(el('div', 'tasks-sec', m('⚙️ Hệ thống')));
      for (const e of sys.slice(-10)) {
        sysBox.appendChild(el('div', 'jr-l lg-' + (e.level || 'info'),
          `<span class="jr-t">[${new Date(e.ts).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}]</span> <span class="jr-m">${esc(e.msg)}</span>`));
      }
    }
  } catch { /* best-effort */ }
  finally { busy = false; }
}
