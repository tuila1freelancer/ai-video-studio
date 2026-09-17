// Catalogues the panel offers: brand folders, metadata styles, BGM.
import { $, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { confirmDialog, promptDialog } from '../../ui/dialog.js';
import { m, tp } from '../../i18n.js';

// ---------------- bgm ----------------
// Brand-asset casting picker (P40): the brand folders that hold mascot cutouts + concept art.
export async function loadBrandFolders() {
  const sel = $('#cfgBrandAssets');
  if (!sel) return;
  let brands = [];
  try { brands = (await api.get('/brands', { ttl: 5000 })).brands || []; } catch { return; }
  const cur = sel.value || 'auto';
  const extra = brands.filter((b) => b && b !== 'Default');
  sel.innerHTML = `<option value="auto">${m('Tự động — thư mục Default')}</option>`
    + extra.map((b) => `<option value="${esc(b)}">${tp`Thư mục: ${esc(b)}`}</option>`).join('')
    + `<option value="none">${m('Tắt')}</option>`;
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'auto';
}
// Named SEO styles (P40): rows in the shared `styles` table, kind 'metadata'. Picking one fills
// the prompt box; the panel still sends the resolved text, so a deleted row can't break a run.
export async function loadMetadataStyles() {
  const sel = $('#cfgMetaStyle');
  if (!sel) return;
  let styles = [];
  try { styles = (await api.get('/styles?kind=metadata')).styles || []; } catch { return; }
  const cur = sel.value;
  sel.innerHTML = `<option value="">${m('— Mặc định —')}</option>`
    + styles.map((st) => `<option value="${esc(st.id)}" data-prompt="${esc(st.prompt || '')}">${esc(st.name)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    if (opt && opt.dataset.prompt !== undefined) $('#cfgMetaPrompt').value = opt.dataset.prompt;
  };
  const del = $('#btnDelMetaStyle');
  if (del) del.onclick = async () => {
    const id = sel.value;
    if (!id) return toast('Chọn một phong cách đã lưu trước.', 'error');
    const ok = await confirmDialog({ title: 'Xoá phong cách này?', body: sel.selectedOptions[0]?.textContent || '', okText: 'Xoá', danger: true });
    if (!ok) return;
    await api.del(`/styles/${id}`);
    await loadMetadataStyles();
    toast('Đã xoá ✓', 'success');
  };
  const save = $('#btnSaveMetaStyle');
  if (save) save.onclick = async () => {
    const prompt = $('#cfgMetaPrompt')?.value.trim();
    if (!prompt) return toast('Nhập yêu cầu SEO trước đã.', 'error');
    const name = await promptDialog({ title: 'Tên phong cách SEO', placeholder: 'vd: Chuyên gia, không giật tít' });
    if (!name) return;
    await api.post('/styles', { name, kind: 'metadata', prompt });
    await loadMetadataStyles();
    toast('Đã lưu phong cách ✓', 'success');
  };
}
export async function loadBgmOptions() {
  const { items } = await api.get('/library/bgm');
  $('#cfgBgm').innerHTML = `<option value="">${m('— Không —')}</option>` + items.map((i) => `<option value="${esc(i.path)}">${esc(i.name)}</option>`).join('');
}
