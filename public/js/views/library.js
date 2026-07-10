import { $, $$, el, esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state } from '../state.js';
import { registerPageHook } from './nav.js';
import { loadBgmOptions } from './config.js';

export function initLibrary() {
  registerPageHook('library', loadLibrary);
  $$('#page-library .gtab').forEach((b) => b.addEventListener('click', () => {
    $$('#page-library .gtab').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    state.libKind = b.dataset.kind; loadLibrary();
  }));
  $('#libUpload').addEventListener('change', async (e) => {
    const fd = new FormData(); [...e.target.files].forEach((f) => fd.append('files', f));
    await api.upload('/library/' + state.libKind, fd);
    loadLibrary(); loadBgmOptions(); toast('Đã tải lên ✓', 'success');
  });
}

export async function loadLibrary() {
  const { items } = await api.get('/library/' + state.libKind);
  $('#libStat').textContent = `${items.length} file`;
  const grid = $('#libGrid');
  if (!items.length) { grid.innerHTML = '<div class="empty">Chưa có file</div>'; return; }
  grid.innerHTML = '';
  items.forEach((it) => {
    const d = el('div', 'libitem');
    const isImg = /\.(png|jpg|jpeg|webp|gif)$/i.test(it.filename);
    d.innerHTML = `<div class="lp">${isImg ? `<img src="${fileUrl(it.path)}" loading="lazy" decoding="async">` : icon(state.libKind === 'brand' ? 'image' : 'music', 26)}</div>
      <div class="ln">${esc(it.name)}</div><button class="btn sm danger" style="margin-top:6px;width:100%">${icon('trash', 13)} Xoá</button>`;
    d.querySelector('button').addEventListener('click', async () => { await api.del('/library/' + it.id); loadLibrary(); loadBgmOptions(); });
    grid.appendChild(d);
  });
}
