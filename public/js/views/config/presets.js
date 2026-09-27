// The channel preset bar and the subtitle preset gallery.
import { $, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { confirmDialog, promptDialog, menuDialog } from '../../ui/dialog.js';
import { icon } from '../../ui/icons.js';
import { m, tp } from '../../i18n.js';
import { gatherSubtitleConfig, saveSubtitleDefaults, updateSubPreview } from './subtitle-studio.js';
import { gatherConfig, applyConfig, pourSubtitleBundle } from './form.js';
import { updateCfgChips } from './groups.js';

// ================= channel presets bar =================
export async function loadChannelPresets(prefetched = null) {
  if (!state.activeChannel) return;
  try {
    const { presets } = prefetched || await api.get(`/channels/${state.activeChannel}/presets`);
    state.presets = presets || [];
  } catch { state.presets = []; }
  const sel = $('#cfgPresetSelect');
  sel.innerHTML = `<option value="">${m('— Config gốc kênh —')}</option>`
    + state.presets.map((p) => `<option value="${p.id}">${p.is_default ? '⭐ ' : ''}${esc(p.name)}</option>`).join('');
}
export function wirePresetBar() {
  $('#cfgPresetSelect').addEventListener('change', () => {
    const p = state.presets.find((x) => x.id === $('#cfgPresetSelect').value);
    if (p) { applyConfig(p.config || {}); toast(tp`Đã áp preset "${p.name}"`, 'success'); }
    updateCfgChips();
  });
  $('#btnPresetSave').addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Lưu preset', label: 'Tên preset (lưu toàn bộ panel hiện tại)', value: m('Preset mới') });
    if (!name) return;
    const r = await api.post(`/channels/${state.activeChannel}/presets`, { name, config: gatherConfig() });
    if (r.error) return toast(r.error, 'error');
    await loadChannelPresets();
    $('#cfgPresetSelect').value = r.preset.id;
    toast('💾 Đã lưu preset', 'success');
  });
  $('#btnPresetMenu').addEventListener('click', async () => {
    const id = $('#cfgPresetSelect').value;
    const p = state.presets.find((x) => x.id === id);
    if (!p) {
      // nothing selected → the menu still works: offer to save the current panel
      const act0 = await menuDialog({
        title: 'Preset của kênh',
        items: [
          { id: 'save', label: 'Lưu panel hiện tại thành preset mới', icon: icon('save', 15) },
        ],
      });
      if (act0 === 'save') $('#btnPresetSave').click();
      return;
    }
    const act = await menuDialog({
      title: tp`Preset "${p.name}"`,
      items: [
        { id: 'default', label: 'Đặt làm mặc định kênh', icon: icon('star', 15) },
        { id: 'rename', label: 'Đổi tên', icon: icon('edit', 15) },
        { id: 'delete', label: 'Xoá preset', icon: icon('trash', 15), danger: true },
      ],
    });
    if (!act) return;
    if (act === 'default') { await api.put(`/presets/${id}`, { isDefault: true }); toast('⭐ Preset mặc định của kênh', 'success'); }
    else if (act === 'rename') { const n = await promptDialog({ title: 'Đổi tên preset', label: 'Tên mới', value: p.name }); if (n) await api.put(`/presets/${id}`, { name: n }); }
    else if (act === 'delete') { if (await confirmDialog({ title: tp`Xoá preset "${p.name}"?`, okText: 'Xoá', danger: true })) await api.del(`/presets/${id}`); }
    await loadChannelPresets();
  });
}

// ================= subtitle preset gallery =================

/**
 * The name a built-in preset is shown under.
 *
 * `src/subtitles/presets.js` is pure data shared with the render path, so it carries no
 * catalogue; the eight names it ships were Vietnamese in every language until this map put them
 * where `m()` can reach them. A preset the owner saved keeps the name they typed.
 */
const BUILT_IN_NAMES = {
  'classic-karaoke': () => m('Karaoke Vàng'),
  'bold-impact': () => m('Impact Đậm'),
  'neon-glow': () => m('Neon Rực'),
  'boxed-news': () => m('Bản Tin'),
  'shadow-cinema': () => m('Điện Ảnh'),
  'clean-minimal': () => m('Tối Giản'),
  'pop-rounded': () => m('Pop Tròn'),
  'condensed-sport': () => m('Thể Thao'),
};

export function subPresetName(preset) {
  const named = !preset?.mine && BUILT_IN_NAMES[preset?.id];
  return named ? named() : preset?.name || '';
}
export async function loadSubtitlePresets() {
  try { state.subPresets = (await api.get('/subtitle-presets')).presets || []; } catch { state.subPresets = []; }
  renderSubPresetGrid();
}
export function renderSubPresetGrid() {
  const grid = $('#subPresetGrid'); if (!grid) return;
  const cards = state.subPresets.map((p) => {
    const fx = p.effect === 'outline' ? '-webkit-text-stroke:.6px rgba(0,0,0,.9);'
      : p.effect === 'box' ? `background:${p.boxBg || 'rgba(10,10,16,.85)'};padding:1px 6px;border-radius:4px;`
      : p.effect === 'shadow' ? 'text-shadow:0 1px 0 rgba(0,0,0,.8),0 3px 8px rgba(0,0,0,.6);'
      : `text-shadow:0 0 8px ${p.activeColor}AA;`;
    const txt = p.textCase === 'uppercase' ? m('PHỤ ĐỀ') : p.textCase === 'lowercase' ? m('phụ đề') : m('Phụ đề');
    return `<div class="sub-preset-card${state.subPreset === p.id ? ' sel' : ''}" data-id="${p.id}">
      ${p.mine ? `<button class="spc-del" title="${m('Xoá bộ mẫu này')}">×</button>` : ''}
      <div class="spc-demo" style="font-family:${p.fontStack};font-weight:${p.weight};color:${p.activeColor};${fx}">${txt} <span style="color:${p.baseColor};opacity:.75">${m('mẫu')}</span></div>
      <div class="spc-name">${p.mine ? '★ ' : ''}${esc(subPresetName(p))}</div>
    </div>`;
  }).join('');
  grid.innerHTML = `<div class="sub-preset-card${!state.subPreset ? ' sel' : ''}" data-id="">
      <div class="spc-demo" style="font-weight:800;color:var(--text)">${m('Tự chỉnh')}</div>
      <div class="spc-name">${m('Tuỳ biến tay')}</div>
    </div>` + cards;
  grid.querySelectorAll('.sub-preset-card').forEach((c) => c.addEventListener('click', async (e) => {
    if (e.target.closest('.spc-del')) { await deleteSubPreset(c.dataset.id); return; }
    const mine = state.subPresets.find((p) => p.id === c.dataset.id && p.mine);
    // A built-in is an ID the resolver understands, so selecting it is the whole action. A saved
    // one is a bundle of settings the resolver has never heard of, so it has to be POURED BACK
    // INTO the panel — otherwise the card would highlight and nothing would change.
    if (mine) {
      pourSubtitleBundle(mine);
      // the saved bundle names its own base preset, so a look built on "Bản Tin" comes back on it
      state.subPreset = mine.config.subtitlePreset || '';
    } else {
      state.subPreset = c.dataset.id;
    }
    renderSubPresetGrid(); updateSubPreview(); updateCfgChips(); saveSubtitleDefaults();
  }));
}

async function deleteSubPreset(id) {
  const p = state.subPresets.find((x) => x.id === id);
  if (!p || !await confirmDialog(tp`Xoá bộ mẫu "${p.name}"?`)) return;
  try {
    await api.del(`/subtitle-presets/${id}`);
    await loadSubtitlePresets();
    toast(tp`🗑 Đã xoá bộ mẫu ${p.name}`, 'success');
  } catch (e) { toast(tp`✖ Không xoá được: ${e.message}`, 'error'); }
}

/** Name the current look and keep it — usable on every channel, not just this one. */
export async function saveSubPreset() {
  const name = await promptDialog(m('Đặt tên cho bộ mẫu phụ đề này:'), '');
  if (!name || !name.trim()) return;
  try {
    const r = await api.post('/subtitle-presets', { name: name.trim(), config: gatherSubtitleConfig() });
    await loadSubtitlePresets();
    toast(tp`💾 Đã lưu bộ mẫu "${r.preset.name}" — dùng lại được ở mọi kênh`, 'success');
  } catch (e) { toast(tp`✖ Không lưu được bộ mẫu: ${e.message}`, 'error'); }
}
