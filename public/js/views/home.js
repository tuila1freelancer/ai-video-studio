import { $, $$, el, esc, badgeText } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { fileUrl, withLock } from '../api.js';
import { state } from '../state.js';
import { registerPageHook, switchPage } from './nav.js';
import { openProject, createAndStart } from './studio.js';

export function initHome() {
  registerPageHook('home', renderGallery);
  $('#heroGo').innerHTML = `${icon('wand', 16)} Tạo video tự động`;
  $('#heroBatch').innerHTML = `${icon('layers', 16)} Hàng loạt`;
  $$('#page-home .gtab').forEach((b) => {
    b.innerHTML = `${icon(b.dataset.cat === 'short' ? 'smartphone' : 'monitor', 14)} ${b.textContent.trim()}`;
  });
  $('#heroGo').addEventListener('click', () => withLock($('#heroGo'), heroGenerate));
  $('#heroTopic').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) withLock($('#heroGo'), heroGenerate); });
  $$('#page-home .gtab').forEach((b) => b.addEventListener('click', () => {
    $$('#page-home .gtab').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    state.galleryCat = b.dataset.cat; renderGallery();
  }));
  renderGallery(); // skeletons until loadProjects resolves
}

export function renderGallery() {
  const grid = $('#galleryGrid');
  const cnt = $('#galleryCount');
  if (!state.projectsLoaded) {
    if (cnt) cnt.textContent = '…';
    grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skel gskel"></div>').join('');
    return;
  }
  const list = state.projects.filter((p) => state.galleryCat === 'landscape' ? p.aspect_ratio === '16:9' : p.aspect_ratio !== '16:9');
  if (cnt) cnt.textContent = `${list.length} video`;
  if (!list.length) { grid.innerHTML = '<div class="empty">Chưa có dự án. Nhập chủ đề phía trên để tạo video đầu tiên.</div>'; return; }
  grid.innerHTML = '';
  list.forEach((p) => {
    const c = el('div', 'gcard');
    const gAr = { '16:9': '16/9', '1:1': '1/1', '4:5': '4/5' }[p.aspect_ratio] || '9/16';
    c.innerHTML = `<div class="gt" style="aspect-ratio:${gAr}">${p.thumb_path ? `<img src="${fileUrl(p.thumb_path)}" loading="lazy" decoding="async" alt="">` : `<div class="ph">${icon('film', 30)}</div>`}
        <span class="badge ${p.status} gstat">${badgeText(p.status)}</span></div>
      <div class="gi"><div class="t">${esc(p.title)}</div><div class="s">${p.aspect_ratio} · ${new Date(p.updated_at).toLocaleDateString('vi-VN')}</div></div>`;
    c.addEventListener('click', () => { switchPage('studio'); openProject(p.id); });
    grid.appendChild(c);
  });
}

async function heroGenerate() {
  const topic = $('#heroTopic').value.trim();
  if (!topic) { toast('Nhập chủ đề trước đã.', 'error'); return; }
  $('#topic').value = topic;
  $('#cfgAr').value = $('#heroAr').value;
  $('#cfgAr').dispatchEvent(new Event('change', { bubbles: true })); // sync segs + summary cards
  switchPage('studio');
  await createAndStart();
  $('#heroTopic').value = '';
}
