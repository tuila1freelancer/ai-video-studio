import { $, $$, el, esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { promptDialog, confirmDialog } from '../ui/dialog.js';
import { api, fileUrl } from '../api.js';
import { state } from '../state.js';
import { registerPageHook } from './nav.js';
import { loadBgmOptions, loadFontFamilies, loadBrandFolders } from './config.js';

export function initLibrary() {
  registerPageHook('library', loadLibrary);
  $$('#page-library .gtab').forEach((b) => b.addEventListener('click', () => {
    $$('#page-library .gtab').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    state.libKind = b.dataset.kind; loadLibrary();
  }));
  $('#libUpload').addEventListener('change', async (e) => {
    const fd = new FormData(); [...e.target.files].forEach((f) => fd.append('files', f));
    // Brand art belongs to the folder currently being browsed — uploading into 'Default' while
    // looking at another brand is how a mascot ends up invisible to casting (P40).
    if (state.libKind === 'brand') fd.append('brand', state.libBrand || 'Default');
    try { await api.upload('/library/' + state.libKind, fd); }
    catch (err) { toast('✗ ' + err.message, 'error'); e.target.value = ''; return; }
    loadLibrary(); loadBgmOptions(); loadFontFamilies(); toast('Đã tải lên ✓', 'success');
  });
}

// Brand folders are browsable (P40): the picker sits above the grid and follows the same list
// the video panel casts from, so what you see here is exactly what the AI can reach for.
let lastCount = 0; // files shown for the brand currently being browsed — the delete confirmation

function renderBrandBar(brands = []) {
  const bar = $('#libBrandBar');
  if (!bar) return;
  bar.style.display = state.libKind === 'brand' ? '' : 'none';
  if (state.libKind !== 'brand') return;
  const cur = state.libBrand || 'Default';
  bar.innerHTML = `<select class="input" id="libBrandSel" style="max-width:240px">${
    brands.map((b) => `<option value="${esc(b)}"${b === cur ? ' selected' : ''}>${esc(b)}</option>`).join('')
  }</select> <button class="btn sm" id="libBrandNew">➕ Thư mục mới</button>
  <button class="btn sm" id="libBrandRename">✏️ Đổi tên</button>
  <button class="btn sm danger" id="libBrandDel">🗑 Xoá thư mục</button>`;
  $('#libBrandSel').onchange = (e) => { state.libBrand = e.target.value; loadLibrary(); };
  // Renaming/deleting a brand folder: the server refuses 'Default' and anything outside the
  // library, and a delete states its file count and must be echoed back before it happens.
  $('#libBrandRename').onclick = async () => {
    const from = state.libBrand || 'Default';
    if (from === 'Default') return toast('Không đổi tên được thư mục Default.', 'error');
    const to = await promptDialog({ title: 'Tên mới cho thư mục', value: from });
    if (!to || to === from) return;
    const r = await api.patch('/brands/rename', { from, to });
    if (r?.error) return toast(r.error, 'error');
    state.libBrand = r.to; loadLibrary(); loadBrandFolders();
    toast('Đã đổi tên ✓', 'success');
  };
  $('#libBrandDel').onclick = async () => {
    const name = state.libBrand || 'Default';
    if (name === 'Default') return toast('Không xoá được thư mục Default.', 'error');
    // The server refuses to delete until it is told, as a number, how many files it is about to
    // destroy — so state exactly that count in the dialog and only then echo it back. If the
    // folder changed on disk since this view loaded, the server 409s and nothing is deleted.
    const n = lastCount;
    const ok = await confirmDialog({
      title: `Xoá thư mục "${name}"?`,
      body: `${n} file trong thư mục này sẽ bị xoá vĩnh viễn khỏi đĩa. Không hoàn tác được.`,
      okText: 'Xoá vĩnh viễn', danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.del(`/brands/${encodeURIComponent(name)}?confirm=${n}`);
      state.libBrand = 'Default'; loadLibrary(); loadBrandFolders();
      toast(`Đã xoá ${r.deleted} file ✓`, 'success');
    } catch (e) {
      toast(e.status === 409 ? 'Thư mục vừa thay đổi — mở lại rồi thử lần nữa.' : e.message, 'error');
      loadLibrary();
    }
  };
  $('#libBrandNew').onclick = async () => {
    const name = await promptDialog({ title: 'Tên thư mục thương hiệu', placeholder: 'vd: The Money Uncle' });
    if (!name) return;
    // The folder is created by the first upload into it; select it so that upload lands right.
    state.libBrand = name.replace(/[^\w.\- ]/g, '').trim() || 'Default';
    toast('Chọn file để tạo thư mục này', 'success');
    loadLibrary();
  };
}

export async function loadLibrary() {
  const q = state.libKind === 'brand' ? `?brand=${encodeURIComponent(state.libBrand || 'Default')}` : '';
  const { items, brands } = await api.get('/library/' + state.libKind + q);
  renderBrandBar(brands || ['Default']);
  lastCount = items.length;
  $('#libStat').textContent = `${items.length} file`;
  const grid = $('#libGrid');
  if (!items.length) { grid.innerHTML = '<div class="empty">Chưa có file</div>'; return; }
  grid.innerHTML = '';
  items.forEach((it) => {
    const d = el('div', 'libitem');
    const isImg = /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(it.filename || it.name);
    const isAudio = state.libKind === 'bgm' || state.libKind === 'sfx';
    const kindIcon = state.libKind === 'brand' ? 'image' : state.libKind === 'font' ? 'edit' : 'music';
    d.innerHTML = `<div class="lp">${isImg ? `<img src="${fileUrl(it.path)}" loading="lazy" decoding="async">` : icon(kindIcon, 26)}</div>
      <div class="ln">${esc(it.name)}</div>
      ${isAudio ? `<audio controls preload="none" src="${fileUrl(it.path)}" style="width:100%;margin-top:6px;height:28px"></audio>` : ''}
      <div class="row" style="margin-top:6px;gap:4px">
        <button class="btn sm" data-act="rename" style="flex:1"${it.onDisk ? ' disabled title="File nằm ngoài thư viện — đổi tên trong Finder"' : ''}>${icon('edit', 12)} Đổi tên</button>
        <button class="btn sm danger" data-act="del" style="flex:1"${it.onDisk ? ' disabled title="File nằm ngoài thư viện — xoá trong Finder"' : ''}>${icon('trash', 12)} Xoá</button>
      </div>`;
    d.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await api.del('/library/' + it.id); loadLibrary(); loadBgmOptions(); loadFontFamilies(); loadBrandFolders();
    });
    d.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      const name = await promptDialog({ title: 'Tên mới', value: it.name });
      if (!name || name === it.name) return;
      const r = await api.patch('/library/' + it.id, { name });
      if (r?.error) return toast(r.error, 'error');
      loadLibrary(); loadBgmOptions(); loadFontFamilies();
      toast('Đã đổi tên ✓', 'success');
    });
    grid.appendChild(d);
  });
}
