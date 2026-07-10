import { $, $$, el, esc, fmtDur } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state, activeChannelBrand } from '../state.js';
import { openVoicePicker } from '../features/voicepicker.js';
import { confirmDialog, promptDialog, menuDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';

const SUB_COLORS = ['#F7B500', '#FFFFFF', '#00E5FF', '#FF5252', '#69F0AE', '#FF80AB', '#E040FB', '#FF6D00', '#40C4FF'];

export function initConfig() {
  // SVG icons on group heads + preset bar (markup keeps emoji as no-JS fallback)
  const GRP_ICONS = { grpFormat: 'film', grpBrand: 'tv', grpSubtitle: 'subtitles', grpAudio: 'music', grpAdvanced: 'settings' };
  Object.entries(GRP_ICONS).forEach(([id, name]) => {
    const ic = document.querySelector(`#${id} .cfg-ic`); if (ic) ic.innerHTML = icon(name, 15);
  });
  $$('.cfg-arr').forEach((a) => { a.innerHTML = icon('edit', 13); });
  const ps = $('#btnPresetSave'); if (ps) ps.innerHTML = icon('save', 14);
  const pm = $('#btnPresetMenu'); if (pm) pm.innerHTML = icon('more', 14);
  const be = $('#btnBrandEditor'); if (be) be.innerHTML = `${icon('palette', 14)} Chỉnh Brand Kit của kênh…`;
  const cv = $('#btnCfgVoice'); if (cv) cv.innerHTML = `${icon('mic', 14)} Chọn giọng đọc (nghe thử)…`;
  wireConfig();
  wireConfigGroups();
  wirePresetBar();
  wireSegs();
  syncSegs();
}

// segmented controls mirror their hidden <select> (gatherConfig keeps reading the select)
function wireSegs() {
  $$('.seg[data-target]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      const sel = $('#' + seg.dataset.target); if (!sel) return;
      sel.value = b.dataset.v;
      sel.dispatchEvent(new Event('change', { bubbles: true })); // bubbles → modal's live-summary listener
      syncSegs();
    });
  });
}
export function syncSegs() {
  $$('.seg[data-target]').forEach((seg) => {
    const v = $('#' + seg.dataset.target)?.value;
    seg.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  });
}

export function gatherConfig() {
  return {
    visualMode: $('#cfgVisualMode').value,
    hyperframe: {
      styleId: state.hfStyleId || 'chrome-kinetic',
      ...(state.hfGuide ? { guide: state.hfGuide } : {}),
      density: $('#cfgHfDensity').value,
      direction: $('#cfgHfDirection').value.trim() || undefined,
      model: $('#cfgHfModel').value.trim() || undefined,
    },
    theme: $('#cfgTheme').value,
    fps: +$('#cfgFps').value,
    resolutionScale: +$('#cfgRes').value,
    watermarkText: $('#cfgWatermark').value.trim(),
    aspectRatio: $('#cfgAr').value,
    videoDuration: +$('#cfgVd').value,
    sceneDuration: +$('#cfgSd').value,
    enableSubtitles: $('#cfgSub').checked,
    subtitlePreset: state.subPreset || undefined,
    subtitleFont: $('#cfgSubFont').value,
    subtitleFontSize: +$('#cfgSubSize').value,
    subtitleTextCase: $('#cfgSubCase').value,
    subtitleColor: state.subColor,
    subtitlePosition: { preset: $('#cfgSubPos').value, marginV: 0.12 },
    bgmPath: $('#cfgBgm').value || null,
    useDefaultBgm: !!$('#cfgBgm').value,
    styleId: $('#cfgStyle').value,
    autoConcat: $('#cfgAutoConcat').checked,
    richAnimation: $('#cfgRich').checked,
    transitions: $('#cfgTrans').checked,
    intro: $('#cfgIntro').checked,
    outro: $('#cfgIntro').checked,
    autoBgm: $('#cfgBgmAuto').checked,
    generateMetadata: $('#cfgMeta').checked,
    parallelTTS: $('#cfgPTts').checked,
    ttsConcurrency: +$('#cfgTtsC').value,
    parallelRender: $('#cfgPRender').checked,
    renderConcurrency: +$('#cfgRenderC').value,
    assets: state.assets,
  };
}
export function applyConfig(cfg = {}) {
  $('#cfgVisualMode').value = cfg.visualMode || 'animation';
  state.hfStyleId = cfg.hyperframe?.styleId || 'chrome-kinetic';
  state.hfGuide = cfg.hyperframe?.guide || null;
  if ($('#cfgHfDensity')) $('#cfgHfDensity').value = cfg.hyperframe?.density || 'balanced';
  if ($('#cfgHfDirection')) $('#cfgHfDirection').value = cfg.hyperframe?.direction || '';
  if ($('#cfgHfModel')) $('#cfgHfModel').value = cfg.hyperframe?.model || '';
  renderHfStyleButton();
  if (cfg.theme) $('#cfgTheme').value = cfg.theme;
  if (cfg.fps) $('#cfgFps').value = cfg.fps;
  if (cfg.resolutionScale) $('#cfgRes').value = cfg.resolutionScale;
  $('#cfgWatermark').value = cfg.watermarkText || '';
  syncVisualModeOpts();
  if (cfg.aspectRatio) $('#cfgAr').value = cfg.aspectRatio;
  if (cfg.videoDuration) $('#cfgVd').value = cfg.videoDuration;
  if (cfg.sceneDuration) $('#cfgSd').value = cfg.sceneDuration;
  $('#cfgSub').checked = cfg.enableSubtitles !== false;
  state.subPreset = cfg.subtitlePreset || '';
  renderSubPresetGrid();
  if (cfg.subtitleFont) $('#cfgSubFont').value = cfg.subtitleFont;
  if (cfg.subtitleFontSize) $('#cfgSubSize').value = cfg.subtitleFontSize;
  if (cfg.subtitleTextCase) $('#cfgSubCase').value = cfg.subtitleTextCase;
  if (cfg.subtitleColor) { state.subColor = cfg.subtitleColor; buildSubColors(); }
  if (cfg.subtitlePosition?.preset) $('#cfgSubPos').value = cfg.subtitlePosition.preset;
  if ('autoConcat' in cfg) $('#cfgAutoConcat').checked = cfg.autoConcat !== false;
  if ('richAnimation' in cfg) $('#cfgRich').checked = cfg.richAnimation !== false;
  if ('transitions' in cfg) $('#cfgTrans').checked = !!cfg.transitions;
  if ('intro' in cfg) $('#cfgIntro').checked = cfg.intro !== false;
  if ('autoBgm' in cfg) $('#cfgBgmAuto').checked = cfg.autoBgm !== false;
  if ('generateMetadata' in cfg) $('#cfgMeta').checked = cfg.generateMetadata !== false;
  updateEstimate(); updateSubPreview(); syncSegs(); updateCfgChips();
}

function syncVisualModeOpts() {
  const mode = $('#cfgVisualMode').value;
  $('#animOpts').style.display = mode === 'animation' ? 'block' : 'none';
  const hf = $('#hfOpts'); if (hf) hf.style.display = mode === 'hyperframe' ? 'block' : 'none';
  updateEstimate();
}
function wireConfig() {
  $('#cfgVisualMode').addEventListener('change', syncVisualModeOpts);
  wireHfStyle();
  $('#cfgVd').addEventListener('input', updateEstimate);
  $('#cfgSd').addEventListener('input', updateEstimate);
  $('#cfgAr').addEventListener('change', updateEstimate);
  ['#cfgSub', '#cfgSubFont', '#cfgSubSize', '#cfgSubCase', '#cfgSubPos'].forEach((id) => $(id).addEventListener('change', updateSubPreview));
  $('#cfgSub').addEventListener('change', () => $('#subStyle').style.display = $('#cfgSub').checked ? 'block' : 'none');
}
export function updateEstimate() {
  const vd = +$('#cfgVd').value, sd = +$('#cfgSd').value;
  $('#cfgVdL').textContent = vd >= 60 ? `${Math.round(vd / 60 * 10) / 10} phút` : `${vd} giây`;
  $('#cfgSdL').textContent = `${sd} giây`;
  const scenes = Math.max(1, Math.round(vd / sd));
  const hfWarn = $('#cfgVisualMode').value === 'hyperframe' && scenes > 40
    ? ` — ⚠ HyperFrame gọi AI cho từng cảnh (${scenes} lần): video dài sẽ tốn thời gian + chi phí` : '';
  $('#cfgEst').textContent = `Ước tính ${scenes} cảnh, ~${Math.round(sd * 2.6)} từ/cảnh${hfWarn}`;
}
export function buildSubColors() {
  const box = $('#cfgSubColors'); if (!box) return; box.innerHTML = '';
  SUB_COLORS.forEach((c) => {
    const s = el('button', 'sw' + (c === state.subColor ? ' active' : '')); s.style.background = c;
    s.addEventListener('click', () => { state.subColor = c; buildSubColors(); updateSubPreview(); });
    box.appendChild(s);
  });
}
export function updateSubPreview() {
  const p = $('#subPreview'); if (!p) return;
  p.style.color = state.subColor; p.style.fontFamily = $('#cfgSubFont').value;
  let txt = 'Phụ đề mẫu'; const c = $('#cfgSubCase').value;
  if (c === 'uppercase') txt = txt.toUpperCase(); else if (c === 'lowercase') txt = txt.toLowerCase();
  p.textContent = txt;
}

// ---------------- HyperFrame style guide ("Phong cách video") ----------------
const HF_FALLBACK = { id: 'chrome-kinetic', name: 'Chrome Kinetic', palette: { bg: '#07070D', ink: '#F2F5FF', accents: ['#7C8CFF', '#22D3EE', '#F59E0B'] } };
function hfCurrentStyle() {
  if (state.hfGuide) return state.hfGuide;
  return (state.hfPresets || []).find((p) => p.id === state.hfStyleId) || HF_FALLBACK;
}
function hfSwatches(g) {
  const cols = [g.palette?.bg, ...(g.palette?.accents || [])].filter(Boolean).slice(0, 4);
  return cols.map((c) => `<i style="background:${esc(c)}"></i>`).join('');
}
function renderHfStyleButton() {
  const sw = $('#hfStyleSw'), nm = $('#hfStyleName');
  if (!sw || !nm) return;
  const g = hfCurrentStyle();
  sw.innerHTML = hfSwatches(g);
  nm.textContent = g.name || g.id;
}
async function loadHfPresets() {
  if (state.hfPresets?.length) return;
  try { state.hfPresets = (await api.get('/hyperframe/presets')).presets || []; } catch { state.hfPresets = []; }
}
function renderHfPresetGrid() {
  const grid = $('#hfPresetGrid'); if (!grid) return;
  const cards = (state.hfPresets || []).map((p) => hfCard(p, !state.hfGuide && state.hfStyleId === p.id));
  if (state.hfGuide) cards.push(hfCard({ ...state.hfGuide, id: 'custom' }, true, true));
  grid.innerHTML = cards.join('');
  grid.querySelectorAll('.hfp-card').forEach((c) => c.addEventListener('click', () => {
    if (c.dataset.id !== 'custom') { state.hfStyleId = c.dataset.id; state.hfGuide = null; }
    renderHfPresetGrid(); renderHfStyleButton(); updateCfgChips();
  }));
}
function hfCard(p, sel, custom = false) {
  const [a0 = '#7C8CFF', a1 = '#22D3EE'] = p.palette?.accents || [];
  const bg = p.palette?.bg || '#07070D', ink = p.palette?.ink || '#fff';
  const treat = p.textTreatment === 'chrome'
    ? 'background:linear-gradient(180deg,#fff,#98A2B8 46%,#EDF1F9 52%,#818BA2);-webkit-background-clip:text;color:transparent'
    : p.textTreatment === 'outline' ? `color:transparent;-webkit-text-stroke:1.2px ${ink}`
      : p.textTreatment === 'neon' ? `color:${ink};text-shadow:0 0 8px ${a0}` : `color:${ink}`;
  return `<div class="hfp-card${sel ? ' sel' : ''}" data-id="${esc(p.id)}">
    <div class="hfp-demo" style="background:radial-gradient(120% 120% at 30% 10%, ${bg} 30%, ${a0}22 100%),${bg}">
      <span class="hfp-kw" style="${treat}">Aa</span>
      <span class="hfp-dot" style="background:${a0}"></span><span class="hfp-dot" style="background:${a1}"></span>
    </div>
    <div class="hfp-name">${custom ? '🎨 ' : ''}${esc(p.name || p.id)}</div>
  </div>`;
}
function wireHfStyle() {
  const btn = $('#btnHfStyle'); if (!btn) return;
  btn.addEventListener('click', async () => {
    await loadHfPresets();
    renderHfPresetGrid();
    $('#hfGenNote').textContent = '';
    $('#hfStyleModal').classList.add('open');
  });
  $('#btnHfGenerate').addEventListener('click', async () => {
    const describe = $('#hfDescribe').value.trim();
    if (!describe) { toast('Mô tả phong cách bạn muốn trước đã.', 'error'); return; }
    const note = $('#hfGenNote');
    note.textContent = '⏳ AI đang thiết kế phong cách…';
    try {
      const r = await api.post('/hyperframe/styleguide', { describe, topic: $('#topic')?.value || '' });
      if (r.error) throw new Error(r.error);
      state.hfGuide = r.guide; state.hfStyleId = 'custom';
      renderHfPresetGrid(); renderHfStyleButton(); updateCfgChips();
      note.textContent = r.source === 'llm' ? `✓ Đã tạo phong cách "${r.guide.name}"` : '⚠ LLM chưa cấu hình — dùng phong cách mặc định';
    } catch (e) { note.textContent = '✗ ' + e.message; }
  });
  renderHfStyleButton();
}

// ---------------- styles / templates / bgm ----------------
export async function loadStyles() {
  const { styles } = await api.get('/styles?kind=scene');
  state.styles = styles;
  $('#cfgStyle').innerHTML = styles.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}
export async function loadTemplates() {
  try { const { templates } = await api.get('/animation/templates'); state.templates = templates || []; } catch { state.templates = []; }
}
export async function loadBgmOptions() {
  const { items } = await api.get('/library/bgm');
  $('#cfgBgm').innerHTML = '<option value="">— Không —</option>' + items.map((i) => `<option value="${esc(i.path)}">${esc(i.name)}</option>`).join('');
}

// ================= config groups: summary cards + edit modal =================
// Each .cfg-group is a read-only summary card; clicking it MOVES the group's live
// .cfg-body node into #cfgModal (ids + listeners travel with the node — never clone),
// and moves it back after the close animation.
const GRP_TITLES = {
  grpFormat: 'Định dạng & chất lượng', grpBrand: 'Thương hiệu kênh', grpSubtitle: 'Phụ đề',
  grpAudio: 'Giọng đọc & nhạc', grpAdvanced: 'Nâng cao',
};
function restoreParkedBody() {
  const slot = $('#cfgModalBody');
  const body = slot?.querySelector('.cfg-body');
  if (slot?.dataset.owner && body) document.getElementById(slot.dataset.owner)?.appendChild(body);
  if (slot) slot.dataset.owner = '';
}
function openCfgGroupModal(group) {
  restoreParkedBody(); // a previous group may still be parked (fast re-open)
  const slot = $('#cfgModalBody');
  const body = group.querySelector('.cfg-body');
  if (!slot || !body) return;
  slot.dataset.owner = group.id;
  slot.appendChild(body);
  $('#cfgModalTitle').textContent = GRP_TITLES[group.id] || 'Cấu hình';
  $('#cfgModal').classList.add('open');
}
function wireConfigGroups() {
  try { localStorage.removeItem('cfgGroups'); } catch { /* accordion-era key */ }
  $$('.cfg-group .cfg-head').forEach((head) => {
    head.addEventListener('click', () => openCfgGroupModal(head.parentElement));
  });
  // restore the body AFTER the 170ms close animation (modal must not empty mid-animation)
  $('#cfgModal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target.id === 'cfgModal') {
      setTimeout(() => { restoreParkedBody(); updateCfgChips(); }, 190);
    }
  });
  // any edit inside the modal refreshes the summary cards live
  $('#cfgModal').addEventListener('change', updateCfgChips);
  $('#cfgModal').addEventListener('input', updateCfgChips);
  const vb = $('#btnCfgVoice');
  if (vb) vb.addEventListener('click', openVoicePicker);
  updateCfgChips();
}
// Current-value summary rendered on each card (data-chip hooks are load-bearing:
// called from palette / brandkit / preset-select / modal edits).
export function updateCfgChips() {
  const set = (k, v) => { const n = document.querySelector(`.cfg-chip[data-chip="${k}"]`); if (n) n.textContent = v; };
  const selText = (id) => { const s = $(id); return s?.selectedOptions?.[0]?.textContent.trim() || ''; };
  const vm = $('#cfgVisualMode').value;
  const mode = vm === 'animation' ? 'Animation' : vm === 'hyperframe' ? 'HyperFrame ✨' : 'Ảnh AI';
  const theme = vm === 'animation' ? ` · ${selText('#cfgTheme').replace(' (mặc định)', '')}`
    : vm === 'hyperframe' ? ` · ${hfCurrentStyle().name || 'Chrome Kinetic'}` : '';
  const res = $('#cfgRes').value === '2' ? '4K' : '1080p';
  set('format', `${mode}${theme} — ${$('#cfgAr').value} · ${$('#cfgFps').value}fps · ${res} · ${fmtDur(+$('#cfgVd').value)} · cảnh ${$('#cfgSd').value}s`);
  const bk = activeChannelBrand();
  set('brand', bk
    ? `${bk.channelName || 'Brand kit (chỉ logo)'} · chèn ${bk.placement === 'always' ? 'cố định' : bk.placement === 'off' ? 'tắt' : 'thông minh'}${bk.logo ? ' · có logo' : ''}`
    : ($('#cfgWatermark').value.trim() ? `Watermark: ${$('#cfgWatermark').value.trim()}` : 'Chưa cấu hình — bấm để thiết lập'));
  const sp = state.subPresets.find((p) => p.id === state.subPreset);
  const pos = { bot: 'dưới', mid: 'giữa', top: 'trên' }[$('#cfgSubPos').value] || 'dưới';
  set('subtitle', $('#cfgSub').checked
    ? `${sp ? sp.name : 'Tuỳ chỉnh'} · ${$('#cfgSubFont').value.split(',')[0].replace(/['"]/g, '')} · cỡ ${$('#cfgSubSize').value} · vị trí ${pos}`
    : 'Tắt phụ đề');
  const lv = state.settings?.tts?.langVoices?.vi;
  const voice = lv ? `${lv.voice} (${lv.provider})` : (state.settings?.tts?.provider ? `provider ${state.settings.tts.provider}` : 'tự chọn');
  set('audio', `Giọng: ${voice} · ${$('#cfgBgm').value ? `BGM: ${selText('#cfgBgm')}` : ($('#cfgBgmAuto').checked ? 'BGM tự động' : 'không BGM')}`);
  const flags = [
    $('#cfgIntro').checked && 'Intro/Outro', $('#cfgTrans').checked && 'Xfade', $('#cfgRich').checked && 'Ảnh AI',
    $('#cfgMeta').checked && 'Metadata', $('#cfgPTts').checked && `TTS ×${$('#cfgTtsC').value}`, $('#cfgPRender').checked && `Render ×${$('#cfgRenderC').value}`,
  ].filter(Boolean).join(' · ');
  set('advanced', `${selText('#cfgStyle') || 'Style mặc định'}${flags ? ' — ' + flags : ''}`);
}

// ================= channel presets bar =================
export async function loadChannelPresets() {
  if (!state.activeChannel) return;
  try {
    const { presets } = await api.get(`/channels/${state.activeChannel}/presets`);
    state.presets = presets || [];
  } catch { state.presets = []; }
  const sel = $('#cfgPresetSelect');
  sel.innerHTML = '<option value="">— Config gốc kênh —</option>'
    + state.presets.map((p) => `<option value="${p.id}">${p.is_default ? '⭐ ' : ''}${esc(p.name)}</option>`).join('');
}
function wirePresetBar() {
  $('#cfgPresetSelect').addEventListener('change', () => {
    const p = state.presets.find((x) => x.id === $('#cfgPresetSelect').value);
    if (p) { applyConfig(p.config || {}); toast(`Đã áp preset "${p.name}"`, 'success'); }
    updateCfgChips();
  });
  $('#btnPresetSave').addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Lưu preset', label: 'Tên preset (lưu toàn bộ panel hiện tại)', value: 'Preset mới' });
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
      title: `Preset "${p.name}"`,
      items: [
        { id: 'default', label: 'Đặt làm mặc định kênh', icon: icon('star', 15) },
        { id: 'rename', label: 'Đổi tên', icon: icon('edit', 15) },
        { id: 'delete', label: 'Xoá preset', icon: icon('trash', 15), danger: true },
      ],
    });
    if (!act) return;
    if (act === 'default') { await api.put(`/presets/${id}`, { isDefault: true }); toast('⭐ Preset mặc định của kênh', 'success'); }
    else if (act === 'rename') { const n = await promptDialog({ title: 'Đổi tên preset', label: 'Tên mới', value: p.name }); if (n) await api.put(`/presets/${id}`, { name: n }); }
    else if (act === 'delete') { if (await confirmDialog({ title: `Xoá preset "${p.name}"?`, okText: 'Xoá', danger: true })) await api.del(`/presets/${id}`); }
    await loadChannelPresets();
  });
}

// ================= subtitle preset gallery =================
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
    const txt = p.textCase === 'uppercase' ? 'PHỤ ĐỀ' : p.textCase === 'lowercase' ? 'phụ đề' : 'Phụ đề';
    return `<div class="sub-preset-card${state.subPreset === p.id ? ' sel' : ''}" data-id="${p.id}">
      <div class="spc-demo" style="font-family:${p.fontStack};font-weight:${p.weight};color:${p.activeColor};${fx}">${txt} <span style="color:${p.baseColor};opacity:.75">mẫu</span></div>
      <div class="spc-name">${esc(p.name)}</div>
    </div>`;
  }).join('');
  grid.innerHTML = `<div class="sub-preset-card${!state.subPreset ? ' sel' : ''}" data-id="">
      <div class="spc-demo" style="font-weight:800;color:var(--text)">Tự chỉnh</div>
      <div class="spc-name">Tuỳ biến tay</div>
    </div>` + cards;
  grid.querySelectorAll('.sub-preset-card').forEach((c) => c.addEventListener('click', () => {
    state.subPreset = c.dataset.id;
    renderSubPresetGrid(); updateSubPreview(); updateCfgChips();
  }));
}
