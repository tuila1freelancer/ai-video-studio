// The project list: load, render, delete (with its footprint), rename.
import { $, badgeText, el, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api, thumbUrl } from '../../api.js';
import { state } from '../../state.js';
import { confirmDialog, promptDialog } from '../../ui/dialog.js';
import { m, tp } from '../../i18n.js';
import { startNewProject, openProject } from './project-view.js';
import { fmtBytes } from '../../ui/format.js';

// ---------------- projects ----------------
export async function loadProjects(prefetched = null) {
  const { projects } = prefetched || await api.get('/projects');
  state.projects = projects;
  state.projectsLoaded = true;
  renderProjectList();
  // home.js listens; importing it here made home ↔ studio a cycle
  document.dispatchEvent(new CustomEvent('projects:changed'));
}
export function renderProjectList() {
  const box = $('#projList');
  if (!state.projects.length) { box.innerHTML = `<div class="empty">${m('Chưa có dự án')}</div>`; return; }
  box.innerHTML = '';
  state.projects.forEach((p) => {
    const it = el('div', 'pitem' + (state.current && state.current.id === p.id ? ' active' : ''));
    it.innerHTML = `${p.thumb_path ? `<img class="thumb" src="${thumbUrl(p.thumb_path, 160, p.updated_at)}" loading="lazy" decoding="async" alt="">` : '<div class="thumb"></div>'}
      <div class="meta"><div class="t">${esc(p.title)}</div><div class="s">${badgeText(p.status)} · ${p.aspect_ratio}</div></div>
      <button class="pitem-ren" title="${esc(m('Đổi tên'))}">✏️</button>
      <button class="pitem-del" title="${esc(m('Xoá dự án'))}">🗑</button>`;
    it.querySelector('.pitem-ren').addEventListener('click', (e) => { e.stopPropagation(); renameProject(p); });
    it.querySelector('.pitem-del').addEventListener('click', (e) => { e.stopPropagation(); deleteProject(p); });
    it.addEventListener('click', () => openProject(p.id));
    box.appendChild(it);
  });
}


/**
 * Delete ONE project, files and all.
 *
 * Deleting takes the files with it (owner's call, 2026-08-12), so the dialog has to name what
 * goes: a confirmation that says "xoá dự án?" while quietly removing 4 GB of 4K clips is not a
 * confirmation. The footprint is fetched from the server FIRST — the real file count and the real
 * bytes, not an estimate — and a running project is refused outright rather than deleted out from
 * under its own pipeline.
 */
async function deleteProject(p) {
  if (['running', 'queued'].includes(p.status)) {
    return toast('Dự án đang chạy — bấm Dừng trước khi xoá.', 'error');
  }
  let fp = null;
  try { fp = await api.get(`/projects/${p.id}/footprint`); } catch { /* deleted underneath us */ }
  const lines = fp ? [
    tp`Trạng thái: ${badgeText(fp.status)} · ${fp.scenes} cảnh`,
    tp`${fp.clips} clip cảnh` + (fp.hasVideo ? m(' · video hoàn chỉnh') : '') + (fp.covers ? tp` · ${fp.covers} ảnh bìa` : ''),
    '',
    tp`SẼ XOÁ VĨNH VIỄN ${fp.files} file (${fmtBytes(fp.bytes)}) khỏi ổ đĩa.`,
    m('Không khôi phục được. Kịch bản, giọng đọc, clip và video hoàn chỉnh đều mất.'),
  ] : [m('Không đọc được dung lượng — vẫn sẽ xoá dự án và toàn bộ file của nó.')];
  const ok = await confirmDialog({
    title: tp`Xoá "${(p.title || m('dự án')).slice(0, 60)}"?`,
    body: lines.join('\n'),
    okText: 'Xoá vĩnh viễn',
    cancelText: 'Giữ lại',
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await api.del(`/projects/${p.id}`);
    toast(tp`🗑 Đã xoá — ${r.files || 0} file (${fmtBytes(r.bytes || 0)})`, 'success');
    // The open project just ceased to exist; leaving its panel on screen would offer buttons
    // that now act on nothing.
    if (state.current?.id === p.id) startNewProject();
    await loadProjects();
  } catch (e) { toast(tp`✖ Không xoá được: ${e.message}`, 'error'); }
}

/** Rename from the list too — the topbar only ever shows the project that is open. */
async function renameProject(p) {
  const name = await promptDialog({ title: 'Đổi tên dự án', label: 'Tên dự án', value: p.title || '' });
  if (name == null) return;
  const title = String(name).trim();
  if (!title || title === p.title) return;
  try {
    // metadata, not config (a fingerprint input); fetched whole first — the list row carries none
    const md = { ...((await api.get(`/projects/${p.id}?scenes=0`)).project?.metadata || {}), titleLocked: true };
    await api.put(`/projects/${p.id}`, { title, metadata: md });
    p.title = title; p.metadata = md;
    if (state.current?.id === p.id) state.current.title = title;
    renderProjectList();
    toast(tp`✏️ Đã đổi tên: ${title}`, 'success');
  } catch (e) { toast(tp`✖ Không đổi được tên: ${e.message}`, 'error'); }
}
