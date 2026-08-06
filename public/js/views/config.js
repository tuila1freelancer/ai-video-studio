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
    visualMode: 'hyperframe', // single visual mode (P36)
    hyperframe: {
      styleId: state.hfStyleId || 'tuila1-hud-cyber',
      ...(state.hfGuide ? { guide: state.hfGuide } : {}),
      density: $('#cfgHfDensity').value,
      direction: $('#cfgHfDirection').value.trim() || undefined,
      model: $('#cfgHfModel').value.trim() || undefined,
      consistent: $('#cfgHfConsistent')?.checked || false,
      imageFull: $('#cfgHfImageFull') ? $('#cfgHfImageFull').checked : true,
    },
    // P40 brand casting: 'auto' → the Default folder, a folder name → that folder, 'none' → off.
    brandAssets: $('#cfgBrandAssets') ? $('#cfgBrandAssets').value : 'auto',
    overlay: $('#cfgOverlay')?.checked
      ? { enabled: true, source: $('#cfgOverlaySrc')?.value.trim() || null }
      : { enabled: false },
    soundDesign: $('#cfgSoundDesign') ? $('#cfgSoundDesign').checked : true,
    fps: +$('#cfgFps').value,
    resolutionScale: +$('#cfgRes').value,
    watermarkText: $('#cfgWatermark').value.trim(),
    aspectRatio: $('#cfgAr').value,
    // MUST be undefined for 'auto', never the string. mergeConfigLayers skips ONLY undefined
    // (core/config.js), and the merge order is defaults → channel → preset → this. Emitting
    // 'auto' would overwrite a channel that declared its language, so the channel default could
    // never win — the same trap already documented for durationMode below. null is worse: it is
    // not skipped either, and it would clobber the channel with a value the resolver rejects.
    language: $('#cfgLang')?.value === 'auto' ? undefined : ($('#cfgLang')?.value || undefined),
    videoDuration: +$('#cfgVd').value,
    sceneDuration: +$('#cfgSd').value,
    enableSubtitles: $('#cfgSub').checked,
    subtitleMode: $('#cfgSubMode')?.value === 'plain' ? 'plain' : 'karaoke',
    subtitleChunk: $('#cfgSubChunk')?.value || 'auto',
    subtitleWordsPerCue: +($('#cfgSubWords')?.value || 4),
    // Subtitles are printed onto the finished video, never baked into the clips. This is stated
    // rather than chosen: the panel used to offer a 'scene' lane, and picking it made every later
    // subtitle edit cost one render per scene with no way back out of the clips. Sending it
    // explicitly (not `undefined`) is what moves an older project onto the lane when its config
    // is saved — a one-time re-render that the change queue prices before it runs.
    subtitleLane: 'final',
    // '' is a real answer here — "Tuỳ biến tay". Sending `undefined` for it (as this did) meant
    // the channel's saved preset won the merge back, so custom subtitles could never be chosen:
    // the card showed selected and the video came out styled by the old preset.
    subtitlePreset: state.subPreset || '',
    // …but an EMPTY FONT is not an answer, it is a picker that has not loaded yet (the family
    // list arrives over the network). Writing it would blank the font on whatever it is merged
    // into, which is how a saved subtitle look disappears.
    subtitleFont: $('#cfgSubFont').value || undefined,
    subtitleFontSize: +$('#cfgSubSize').value || undefined,
    // Empty means "whatever the preset says". The panel used to send 'original' unconditionally,
    // and captionStyleFrom reads `c.subtitleTextCase || preset.textCase` — so the presets that
    // declare uppercase (Impact Đậm, Thể Thao, Punch) could NEVER apply it. Their preview cards
    // showed uppercase; the rendered video did not.
    subtitleTextCase: $('#cfgSubCase').value || undefined,
    subtitleColor: state.subColor,
    subtitlePosition: { preset: $('#cfgSubPos').value, marginV: 0.12 },
    bgmPath: $('#cfgBgm').value || null,
    useDefaultBgm: !!$('#cfgBgm').value,
    ...($('#cfgBrandFont')?.value ? { fonts: { display: $('#cfgBrandFont').value } } : {}),
    autoConcat: $('#cfgAutoConcat').checked,
    requireReview: $('#cfgReview')?.checked || false,
    sceneGate: $('#cfgSceneGate')?.checked || false,
    // ALWAYS explicit: an omitted key would let a channel/preset 'auto' silently win the
    // config merge while the panel shows target mode.
    durationMode: $('#cfgDurMode')?.value === 'auto' ? 'auto' : 'target',
    transitions: $('#cfgTrans').checked,
    // P43: the owner can name ONE look for the whole video; 'auto' keeps the role doctrine
    transitionStyle: $('#cfgTransStyle')?.value || 'auto',
    autoBgm: $('#cfgBgmAuto').checked,
    generateMetadata: $('#cfgMeta').checked,
    // P40: named SEO styles are rows in the shared `styles` table (kind 'metadata'); the panel
    // sends the resolved PROMPT so a run never depends on a row still existing.
    metadataPrompt: $('#cfgMetaPrompt')?.value.trim() || undefined,
    // P40: silent mode — motion + captions on the script's timing, no voice, no TTS credit.
    enableVoice: $('#cfgNoVoice')?.checked ? false : undefined,
    parallelTTS: $('#cfgPTts').checked,
    ttsConcurrency: +$('#cfgTtsC').value,
    parallelRender: $('#cfgPRender').checked,
    renderConcurrency: +$('#cfgRenderC').value,
    assets: state.assets,
  };
}
export function applyConfig(cfg = {}) {
  // Populating the panel is not the owner editing it. Without this, every channel switch and
  // every preset click would fire the subtitle autosave and write the config that was just
  // loaded straight back — harmless on the way out, but it makes the "đã lưu" line lie about
  // what happened, and one crossed wire away from a channel saving another channel's look.
  applying = true;
  try { applyConfigInner(cfg); } finally { applying = false; }
}
let applying = false;

function applyConfigInner(cfg = {}) {
  state.hfStyleId = cfg.hyperframe?.styleId || 'tuila1-hud-cyber';
  state.hfGuide = cfg.hyperframe?.guide || null;
  if ($('#cfgHfDensity')) $('#cfgHfDensity').value = cfg.hyperframe?.density || 'balanced';
  if ($('#cfgHfDirection')) $('#cfgHfDirection').value = cfg.hyperframe?.direction || '';
  if ($('#cfgHfModel')) $('#cfgHfModel').value = cfg.hyperframe?.model || '';
  renderHfStyleButton();
  if (cfg.fps) $('#cfgFps').value = cfg.fps;
  if (cfg.resolutionScale) $('#cfgRes').value = cfg.resolutionScale;
  $('#cfgWatermark').value = cfg.watermarkText || '';
  if (cfg.aspectRatio) $('#cfgAr').value = cfg.aspectRatio;
  // UNCONDITIONAL, unlike its neighbours. This runs on every channel switch, so a guarded
  // `if (cfg.language)` would leave the picker showing the previous channel's language — and
  // gatherConfig would then PIN it onto a project that should have been auto.
  if ($('#cfgLang')) $('#cfgLang').value = cfg.language || 'auto';
  if (cfg.videoDuration) $('#cfgVd').value = cfg.videoDuration;
  if (cfg.sceneDuration) $('#cfgSd').value = cfg.sceneDuration;
  $('#cfgSub').checked = cfg.enableSubtitles !== false;
  state.subPreset = cfg.subtitlePreset || '';
  renderSubPresetGrid();
  if ($('#cfgSubMode')) $('#cfgSubMode').value = cfg.subtitleMode === 'plain' ? 'plain' : 'karaoke';
  if ($('#cfgSubChunk')) $('#cfgSubChunk').value = ['sentence', 'words'].includes(cfg.subtitleChunk) ? cfg.subtitleChunk : 'auto';
  if ($('#cfgSubWords')) {
    $('#cfgSubWords').value = cfg.subtitleWordsPerCue || 4;
    $('#cfgSubWordsL').textContent = $('#cfgSubWords').value;
    $('#subWordsRow').classList.toggle('hidden', $('#cfgSubChunk')?.value !== 'words');
  }
  updateSubLaneHint(cfg);
  // Every subtitle restore below is UNCONDITIONAL, and that is the point. applyConfig runs on
  // every channel switch and every preset click; a guarded `if (cfg.subtitleFont)` leaves the
  // PREVIOUS channel's font sitting in the picker on a channel that never chose one — and
  // gatherConfig then pins it onto the new channel's video. The same trap is already documented
  // for #cfgLang and #cfgSubCase; these are the rest of it.
  // (Older configs stored the whole CSS stack — normalize to the bare family the options carry.)
  $('#cfgSubFont').value = cfg.subtitleFont
    ? (String(cfg.subtitleFont).split(',')[0].replace(/['"]/g, '').trim() || cfg.subtitleFont)
    : 'Be Vietnam Pro';
  $('#cfgSubSize').value = cfg.subtitleFontSize || 80;
  $('#cfgSubCase').value = cfg.subtitleTextCase || '';
  state.subColor = cfg.subtitleColor || '#F7B500';
  buildSubColors();
  $('#cfgSubPos').value = cfg.subtitlePosition?.preset || 'bot';
  if ($('#cfgBrandFont')) $('#cfgBrandFont').value = cfg.fonts?.display || '';
  if ('autoConcat' in cfg) $('#cfgAutoConcat').checked = cfg.autoConcat !== false;
  if ('requireReview' in cfg && $('#cfgReview')) $('#cfgReview').checked = cfg.requireReview === true;
  if ('sceneGate' in cfg && $('#cfgSceneGate')) $('#cfgSceneGate').checked = cfg.sceneGate === true;
  if ($('#cfgDurMode')) $('#cfgDurMode').value = cfg.durationMode === 'auto' ? 'auto' : 'target';
  if ('transitions' in cfg) $('#cfgTrans').checked = !!cfg.transitions;
  if ($('#cfgTransStyle')) $('#cfgTransStyle').value = cfg.transitionStyle || 'auto';
  if ('autoBgm' in cfg) $('#cfgBgmAuto').checked = cfg.autoBgm !== false;
  if ('generateMetadata' in cfg) $('#cfgMeta').checked = cfg.generateMetadata !== false;
  if ($('#cfgSoundDesign')) $('#cfgSoundDesign').checked = cfg.soundDesign !== false;
  if ($('#cfgHfConsistent')) $('#cfgHfConsistent').checked = cfg.hyperframe?.consistent === true;
  if ($('#cfgHfImageFull')) $('#cfgHfImageFull').checked = cfg.hyperframe?.imageFull !== false;
  if ($('#cfgBrandAssets')) $('#cfgBrandAssets').value = cfg.brandAssets === false ? 'none' : (cfg.brandAssets || 'auto');
  if ($('#cfgNoVoice')) $('#cfgNoVoice').checked = cfg.enableVoice === false;
  if ($('#cfgMetaPrompt')) $('#cfgMetaPrompt').value = cfg.metadataPrompt || '';
  if ($('#cfgOverlay')) {
    $('#cfgOverlay').checked = cfg.overlay?.enabled === true;
    if ($('#cfgOverlaySrc')) $('#cfgOverlaySrc').value = cfg.overlay?.source || '';
    const oo = $('#overlayOpts'); if (oo) oo.style.display = cfg.overlay?.enabled ? 'block' : 'none';
  }
  updateEstimate(); updateSubPreview(); syncSegs(); updateCfgChips();
}

function wireConfig() {
  $('#cfgOverlay')?.addEventListener('change', () => { const oo = $('#overlayOpts'); if (oo) oo.style.display = $('#cfgOverlay').checked ? 'block' : 'none'; });
  wireHfStyle();
  $('#cfgVd').addEventListener('input', updateEstimate);
  $('#cfgSd').addEventListener('input', updateEstimate);
  $('#cfgDurMode')?.addEventListener('change', updateEstimate);
  $('#cfgAr').addEventListener('change', updateEstimate);
  ['#cfgSub', '#cfgSubFont', '#cfgSubSize', '#cfgSubCase', '#cfgSubPos', '#cfgSubMode', '#cfgSubChunk'].forEach((id) => $(id)?.addEventListener('change', updateSubPreview));
  // …and every one of them, plus the two that only fire 'input', writes the look back onto the
  // channel. The switch is in this list on purpose: turning subtitles off has to be remembered
  // too, and the server keeps the style keys untouched while it does.
  ['#cfgSub', '#cfgSubFont', '#cfgSubSize', '#cfgSubCase', '#cfgSubPos', '#cfgSubMode', '#cfgSubChunk', '#cfgSubWords']
    .forEach((id) => $(id)?.addEventListener('change', () => saveSubtitleDefaults()));
  $('#cfgSub').addEventListener('change', () => $('#subStyle').style.display = $('#cfgSub').checked ? 'block' : 'none');
  $('#cfgSubChunk')?.addEventListener('change', () => $('#subWordsRow').classList.toggle('hidden', $('#cfgSubChunk').value !== 'words'));
  $('#cfgSubWords')?.addEventListener('input', () => { $('#cfgSubWordsL').textContent = $('#cfgSubWords').value; });
  // A font that has not been fetched would substitute in the preview AND in the video. Rather
  // than hiding it or letting it fail quietly, the picker offers to go and get it.
  $('#cfgSubFont')?.addEventListener('change', async () => {
    const fam = $('#cfgSubFont').value;
    const entry = (state.fontFamilies || []).find((f) => f.family === fam);
    $('#cfgSubFontGet')?.classList.toggle('hidden', !entry || entry.ready);
    await ensureFontLoaded(fam);
    updateSubPreview();
  });
  $('#btnFramePreview')?.addEventListener('click', refreshFramePreview);
  $('#framePreviewAt')?.addEventListener('input', () => { $('#framePreviewT').textContent = fmtT(+$('#framePreviewAt').value); });
  $('#framePreviewAt')?.addEventListener('change', refreshFramePreview);
  $('#cfgSubFontGet')?.addEventListener('click', async () => {
    const fam = $('#cfgSubFont').value;
    const btn = $('#cfgSubFontGet');
    btn.disabled = true; btn.textContent = '⏳ Đang tải…';
    try {
      const r = await downloadFont(fam);
      toast(`🔤 Đã tải font ${r.family} (${r.faces} kiểu chữ, ${Math.round(r.bytes / 1024)}KB)`, 'success');
      $('#cfgSubFont').value = fam;
      btn.classList.add('hidden');
      saveSubtitleDefaults(); // setting .value fires no 'change' — the pick would go unsaved
    } catch (e) {
      toast(`✖ Không tải được font: ${e.message}`, 'error');
    } finally { btn.disabled = false; btn.textContent = '⬇︎ Tải'; }
  });
}
export function updateEstimate() {
  const vd = +$('#cfgVd').value, sd = +$('#cfgSd').value;
  const auto = $('#cfgDurMode')?.value === 'auto';
  $('#cfgVd').disabled = auto;
  $('#cfgVd').closest('.field')?.classList.toggle('durmode-auto', auto);
  $('#cfgVdL').textContent = auto ? 'tự động' : (vd >= 60 ? `${Math.round(vd / 60 * 10) / 10} phút` : `${vd} giây`);
  $('#cfgSdL').textContent = `${sd} giây`;
  if (auto) {
    $('#cfgEst').textContent = '🪄 Giữ NGUYÊN VĂN kịch bản bạn dán vào — thời lượng video = tổng lời thoại (cần ≥80 từ, nếu ngắn hơn sẽ chạy theo mục tiêu). ⚠ HyperFrame gọi AI theo TỪNG cảnh — kịch bản dài sẽ tốn chi phí tương ứng.';
    return;
  }
  const scenes = Math.max(1, Math.round(vd / sd));
  const hfWarn = scenes > 40
    ? ` — ⚠ HyperFrame gọi AI cho từng cảnh (${scenes} lần): video dài sẽ tốn thời gian + chi phí` : '';
  // (sd − 0.65s nghỉ) × 4.4 wps × 0.95 — đúng công thức wordsForSlot của máy viết kịch bản (vi)
  const wpsScene = Math.max(8, Math.round((sd - 0.65) * 4.4 * 0.95));
  $('#cfgEst').textContent = `Ước tính ${scenes} cảnh, ~${wpsScene} từ/cảnh, tổng ~${scenes * wpsScene} từ${hfWarn}`;
}
export function buildSubColors() {
  const box = $('#cfgSubColors'); if (!box) return; box.innerHTML = '';
  SUB_COLORS.forEach((c) => {
    const s = el('button', 'sw' + (c === state.subColor ? ' active' : '')); s.style.background = c;
    s.addEventListener('click', () => { state.subColor = c; buildSubColors(); updateSubPreview(); saveSubtitleDefaults(); });
    box.appendChild(s);
  });
  // P43: the nine swatches are shortcuts, not the whole palette — any colour is allowed.
  const custom = $('#cfgSubColorCustom');
  if (custom) {
    custom.value = /^#[0-9a-f]{6}$/i.test(state.subColor) ? state.subColor : '#F7B500';
    custom.oninput = () => { state.subColor = custom.value; buildSubColors(); updateSubPreview(); saveSubtitleDefaults(); };
  }
}
/**
 * Say where the subtitles are drawn — and, for a project made before the rule, what moving it
 * over will cost.
 *
 * There is nothing to choose here any more. The panel used to offer a "vẽ trong từng cảnh" lane
 * and it was a trap: captions drawn inside a clip are an INPUT to that clip, so changing the font
 * meant re-rendering every scene, and once burned in they could not be taken back out.
 */
export function updateSubLaneHint(cfg = null) {
  const el = $('#subLaneHint');
  if (!el) return;
  const legacy = cfg && cfg.subtitleLane !== 'final' && !!state.current?.video_path;
  el.innerHTML = '💡 Phụ đề được in <strong>sau khi ghép video hoàn chỉnh</strong>, không nướng vào từng cảnh — '
    + 'nên đổi chữ, font, cỡ, màu hay vị trí về sau chỉ tốn <strong>một lượt ghép</strong>.'
    + (legacy
      ? '<br>⚠ Video này được dựng theo cách cũ (phụ đề nằm sẵn trong từng cảnh). Lần lưu cấu hình tới sẽ '
        + 'chuyển nó sang cách mới: phải dựng lại clip <em>không có</em> phụ đề <strong>một lần duy nhất</strong> — '
        + 'bảng chi phí sẽ báo trước khi chạy.'
      : '');
}

// ---------------- the channel remembers its subtitles ----------------
// Owner order 2026-08-06: editing a channel's subtitles saves them for that channel, so the next
// video starts where the last one left off. Before this the style lived only in the project being
// edited, and carrying it forward meant finding a save icon inside the channel-management dialog
// that wrote the WHOLE panel over the channel — so most videos got their font picked again.
//
// The server owns what may be stored and what counts as a real value
// (api/services/subtitle-defaults.js). That is what makes the on/off switch safe: turning
// subtitles off sends `enableSubtitles: false` and nothing else changes, so turning them back on
// restores the same look.
const SUBTITLE_CFG_KEYS = ['enableSubtitles', 'subtitleMode', 'subtitleChunk', 'subtitleWordsPerCue',
  'subtitlePreset', 'subtitleFont', 'subtitleFontSize', 'subtitleTextCase', 'subtitleColor', 'subtitlePosition'];

export function gatherSubtitleConfig() {
  const all = gatherConfig();
  return Object.fromEntries(SUBTITLE_CFG_KEYS.filter((k) => all[k] !== undefined).map((k) => [k, all[k]]));
}

let subSaveTimer = null;
/** Persist the subtitle look onto the active channel. Debounced — this runs on every keystroke. */
export function saveSubtitleDefaults({ now = false } = {}) {
  if (applying || !state.activeChannel) return;
  clearTimeout(subSaveTimer);
  const go = async () => {
    const note = $('#subSaveNote');
    try {
      const r = await api.put(`/channels/${state.activeChannel}/subtitle-defaults`, { config: gatherSubtitleConfig() });
      const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
      if (ch && r.channel) ch.config = r.channel.config; // keep the in-memory copy honest
      if (note) {
        note.textContent = `💾 Đã lưu kiểu phụ đề cho kênh ${ch?.name || ''}`.trim()
          + (r.presetUpdated ? ' (kể cả preset mặc định)' : '') + ' — video sau tự dùng lại.';
      }
    } catch (e) {
      if (note) note.textContent = `⚠ Chưa lưu được kiểu phụ đề cho kênh: ${e.message}`;
    }
  };
  if (now) go(); else subSaveTimer = setTimeout(go, 700);
}

// The effects the renderer draws, restated in CSS. Kept in the same order and with the same
// numbers as buildScenePage's capActFx branch so the two cannot drift apart quietly.
function previewEffect(effect, fs, color, boxBg) {
  if (effect === 'outline') return `-webkit-text-stroke:${Math.max(1, Math.round(fs * 0.045))}px rgba(0,0,0,.92);text-shadow:0 2px 8px rgba(0,0,0,.85)`;
  if (effect === 'box') return `background:${boxBg || 'rgba(10,10,16,.85)'};padding:.06em .28em;border-radius:.16em;box-decoration-break:clone;text-shadow:none`;
  if (effect === 'shadow') return 'text-shadow:0 2px 0 rgba(0,0,0,.85),0 5px 16px rgba(0,0,0,.7)';
  return `text-shadow:0 0 ${Math.round(fs * 0.5)}px ${color}, 0 0 ${Math.round(fs * 0.18)}px ${color}`;
}

/**
 * Show what the video will look like, not a coloured word in the app's own font.
 *
 * The old preview set `fontFamily` and a colour. That was the entire extent of it — no effect, no
 * position, no karaoke, and (because the UI stylesheet carried two families) usually not even
 * the right typeface. It answered a question nobody had while looking like it answered the one
 * everybody did.
 */
export function updateSubPreview() {
  const p = $('#subPreview'); if (!p) return;
  const fam = $('#cfgSubFont').value.split(',')[0].replace(/['"]/g, '').trim();
  ensureFontLoaded(fam);
  const preset = state.subPresets?.find((x) => x.id === state.subPreset);
  const plain = $('#cfgSubMode')?.value === 'plain';
  const pos = $('#cfgSubPos')?.value || 'bot';
  const fs = Math.round((+$('#cfgSubSize').value || 80) * 0.28); // preview box ≈ 28% of frame height
  const accent = state.subColor || preset?.activeColor || '#F7B500';
  const base = preset?.baseColor || '#FFFFFF';
  const effect = preset?.effect || 'glow';

  let txt = plain ? 'Phụ đề thường — dòng tĩnh' : 'Phụ đề mẫu của bạn';
  // same precedence as captionStyleFrom / assStyleFrom: an explicit pick, else the preset's
  const c = $('#cfgSubCase').value || preset?.textCase || 'original';
  if (c === 'uppercase') txt = txt.toUpperCase();
  else if (c === 'lowercase') txt = txt.toLowerCase();
  else if (c === 'titlecase') txt = txt.replace(/\p{L}[\p{L}\p{M}']*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

  const words = txt.split(' ');
  const hit = plain ? -1 : Math.min(words.length - 1, 2); // one word accented, like the renderer
  const align = { bot: 'flex-end', mid: 'center', top: 'flex-start' }[pos] || 'flex-end';
  p.style.cssText = `margin-top:8px;background:#07070d;border-radius:8px;padding:12px;display:flex;`
    + `align-items:${align};justify-content:center;min-height:118px;overflow:hidden`;
  p.innerHTML = `<div style="font-family:'${fam}',sans-serif;font-weight:${preset?.weight || 800};`
    + `font-size:${fs}px;line-height:1.2;text-align:center">`
    + words.map((w, i) => `<span style="color:${i === hit ? accent : base};opacity:${i === hit ? 1 : (i < hit ? 0.95 : 0.55)};`
      + `${previewEffect(effect, fs, i === hit ? accent : base, preset?.boxBg)}">${w}</span>`).join(' ')
    + '</div>';
}

// ---------------- real-frame preview ----------------
// The style preview above is CSS pretending to be the renderer. This one IS the renderer: the
// server pulls a frame out of the finished video and runs it through resolveConcatLogo/logoRect
// and libass — the same code the concat calls. About a second, against the fifteen minutes of
// re-concatenating it replaces.
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function syncFramePreviewAvailability() {
  const box = $('#framePreviewBox');
  if (!box) return;
  const ok = !!state.current?.id && !!state.current?.video_path;
  box.classList.toggle('hidden', !ok);
  // projects carry no duration column; the scene rows do, and their sum is close enough to
  // scale a scrubber (the server clamps to the real file anyway)
  const dur = Math.max(1, Math.round((state.scenes || []).reduce((a, s) => a + (s.duration || 0), 0)));
  const sl = $('#framePreviewAt');
  if (sl && dur > 1) { sl.max = String(dur); if (+sl.value > dur) sl.value = String(Math.round(dur * 0.15)); }
  if (sl) $('#framePreviewT').textContent = fmtT(+sl.value);
}

export async function refreshFramePreview() {
  const img = $('#framePreviewImg'); const note = $('#framePreviewNote');
  const btn = $('#btnFramePreview');
  if (!img || !state.current?.id) return;
  const t = +($('#framePreviewAt')?.value || 15);
  btn.disabled = true; note.textContent = '⏳ Đang dựng khung thật…';
  try {
    // the panel's LIVE values, not what is saved — the owner is previewing a change in progress
    const cfg = encodeURIComponent(JSON.stringify(gatherConfig()));
    const url = `/api/projects/${state.current.id}/frame-preview?t=${t}&cfg=${cfg}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const warn = res.headers.get('X-Preview-Note');
    img.src = URL.createObjectURL(await res.blob());
    img.classList.remove('hidden');
    note.textContent = warn ? `⚠ ${decodeURIComponent(warn)}` : 'Khung thật của video — logo và phụ đề đi qua đúng đường ghép cuối.';
  } catch (e) {
    note.textContent = `✖ ${e.message}`;
  } finally { btn.disabled = false; }
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
  // Persistent brand kit: pin the selected style as the CHANNEL's canonical guide —
  // every new project of the channel inherits it automatically.
  $('#btnHfSaveChannel')?.addEventListener('click', async () => {
    const note = $('#hfGenNote');
    try {
      const { active } = await api.get('/channels');
      if (!active) { toast('Chưa có kênh đang hoạt động.', 'error'); return; }
      const g = hfCurrentStyle();
      const guide = state.hfGuide || g; // custom guide object, or the chosen preset's full data
      await api.post(`/channels/${active}/style-guide`, { guide });
      note.textContent = `✓ Đã đặt "${guide.name || guide.id}" làm phong cách mặc định của kênh`;
      toast('Đã lưu phong cách cho kênh 🎨', 'success');
    } catch (e) { note.textContent = '✗ ' + e.message; }
  });
  renderHfStyleButton();
}

// ---------------- bgm ----------------
// Brand-asset casting picker (P40): the brand folders that hold mascot cutouts + concept art.
export async function loadBrandFolders() {
  const sel = $('#cfgBrandAssets');
  if (!sel) return;
  let brands = [];
  try { brands = (await api.get('/brands')).brands || []; } catch { return; }
  const cur = sel.value || 'auto';
  const extra = brands.filter((b) => b && b !== 'Default');
  sel.innerHTML = '<option value="auto">Tự động — thư mục Default</option>'
    + extra.map((b) => `<option value="${esc(b)}">Thư mục: ${esc(b)}</option>`).join('')
    + '<option value="none">Tắt</option>';
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
  sel.innerHTML = '<option value="">— Mặc định —</option>'
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
  $('#cfgBgm').innerHTML = '<option value="">— Không —</option>' + items.map((i) => `<option value="${esc(i.path)}">${esc(i.name)}</option>`).join('');
}
// ---------------- fonts ----------------
// Both pickers are built from /fonts/families, which is the app's ONE list. index.html used to
// carry ten hard-coded <option>s, two of which (Arial, Impact) existed in neither the vendored
// CSS nor the burn directory — so the owner could pick a font the renderer had never heard of
// and nothing anywhere said so.
const SOURCE_MARK = { uploaded: '📤 ', downloaded: '⬇︎ ', system: '🖥 ', downloadable: '☁️ ' };
const loadedFaces = new Set();

/**
 * Pull a family's real bytes into the page before anything claims to show it.
 *
 * The old preview just set `fontFamily` and hoped. The app's own stylesheet only ever loaded
 * Lexend and JetBrains Mono, so picking Anton painted the system sans-serif and looked, to the
 * owner, exactly like a font that simply did not work.
 */
export async function ensureFontLoaded(family) {
  if (!family || loadedFaces.has(family)) return;
  loadedFaces.add(family);
  try {
    const css = await (await fetch(`/api/fonts/${encodeURIComponent(family)}/css`)).text();
    if (css.trim()) {
      const el = document.createElement('style');
      el.dataset.font = family;
      el.textContent = css;
      document.head.appendChild(el);
    }
    if (document.fonts?.load) await document.fonts.load(`16px "${family}"`);
  } catch { /* the picker already marks unready families; a failed fetch just leaves it unloaded */ }
}

export async function loadFontFamilies() {
  let families = [];
  try { families = (await api.get('/fonts/families')).families || []; } catch { return; }
  state.fontFamilies = families;
  const label = (f) => `${SOURCE_MARK[f.source] || ''}${f.family}${f.ready ? '' : ' — chưa tải'}`;

  const bf = $('#cfgBrandFont');
  if (bf) {
    const cur = bf.value;
    bf.innerHTML = '<option value="">— Theo style guide —</option>'
      + families.filter((f) => f.ready).map((f) => `<option value="${esc(f.family)}">${esc(label(f))}</option>`).join('');
    bf.value = cur;
  }
  const sf = $('#cfgSubFont');
  if (sf) {
    // option value = BARE family name: one canonical form feeds both the harness caption stack
    // and the ASS FontName, which must be a plain family or libass cannot match it.
    const cur = sf.value;
    sf.innerHTML = families.map((f) =>
      `<option value="${esc(f.family)}" style="font-family:'${esc(f.family)}',sans-serif"${f.ready ? '' : ' data-unready="1"'}>${esc(label(f))}</option>`).join('');
    sf.value = cur || 'Be Vietnam Pro';
  }
  // draw the options in their own typeface — choosing a font you cannot see is guesswork
  await Promise.all(families.filter((f) => f.ready && f.source !== 'system').slice(0, 12).map((f) => ensureFontLoaded(f.family)));
  await ensureFontLoaded($('#cfgSubFont')?.value);
  updateSubPreview();
}

/** Fetch a catalogue family the owner picked but has not got yet. */
export async function downloadFont(family) {
  const r = await api.post(`/fonts/${encodeURIComponent(family)}/download`, {});
  loadedFaces.delete(family);
  await loadFontFamilies();
  await ensureFontLoaded(family);
  return r;
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
  // the real-frame preview only means anything once there IS a frame
  if (group.id === 'grpSubtitle') syncFramePreviewAvailability();
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
  const mode = 'HyperFrame ✨';
  const theme = ` · ${hfCurrentStyle().name || 'Chrome Kinetic'}`;
  const res = $('#cfgRes').value === '2' ? '4K' : '1080p';
  const durTxt = $('#cfgDurMode')?.value === 'auto' ? '🪄 tự động' : fmtDur(+$('#cfgVd').value);
  set('format', `${mode}${theme} — ${$('#cfgAr').value} · ${$('#cfgFps').value}fps · ${res} · ${durTxt} · cảnh ${$('#cfgSd').value}s`);
  const bk = activeChannelBrand();
  set('brand', bk
    ? `${bk.channelName || 'Brand kit (chỉ logo)'}${bk.finalOverlay?.enabled && bk.logo ? ' · đóng dấu logo' : ''}${bk.watermark?.enabled ? ' · watermark trôi' : ''}${bk.nameBadge?.enabled !== false && bk.channelName ? ' · tên kênh' : ''}`
    : ($('#cfgWatermark').value.trim() ? `Watermark: ${$('#cfgWatermark').value.trim()}` : 'Chưa cấu hình — bấm để thiết lập'));
  const sp = state.subPresets.find((p) => p.id === state.subPreset);
  const pos = { bot: 'dưới', mid: 'giữa', top: 'trên' }[$('#cfgSubPos').value] || 'dưới';
  const subMode = $('#cfgSubMode')?.value === 'plain' ? 'thường' : 'karaoke';
  const subChunk = $('#cfgSubChunk')?.value === 'sentence' ? ' · theo câu'
    : $('#cfgSubChunk')?.value === 'words' ? ` · ${$('#cfgSubWords')?.value || 4} từ/dòng` : '';
  set('subtitle', $('#cfgSub').checked
    ? `${sp ? sp.name : 'Tuỳ chỉnh'} · ${subMode}${subChunk} · ${$('#cfgSubFont').value.split(',')[0].replace(/['"]/g, '')} · cỡ ${$('#cfgSubSize').value} · vị trí ${pos}`
    : 'Tắt phụ đề');
  const lv = state.settings?.tts?.langVoices?.vi;
  const voice = lv ? `${lv.voice} (${lv.provider})` : (state.settings?.tts?.provider ? `provider ${state.settings.tts.provider}` : 'tự chọn');
  set('audio', `Giọng: ${voice} · ${$('#cfgBgm').value ? `BGM: ${selText('#cfgBgm')}` : ($('#cfgBgmAuto').checked ? 'BGM tự động' : 'không BGM')}`);
  const flags = [
    $('#cfgSceneGate')?.checked && 'Duyệt cảnh trước 🎬', $('#cfgReview')?.checked && 'Duyệt trước ghép',
    $('#cfgTrans').checked && 'Xfade',
    $('#cfgMeta').checked && 'Metadata', $('#cfgPTts').checked && `TTS ×${$('#cfgTtsC').value}`, $('#cfgPRender').checked && `Render ×${$('#cfgRenderC').value}`,
  ].filter(Boolean).join(' · ');
  set('advanced', flags || 'Mặc định');
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
    renderSubPresetGrid(); updateSubPreview(); updateCfgChips(); saveSubtitleDefaults();
  }));
}
