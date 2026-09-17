// The config form: wiring, segmented controls, gatherConfig()/applyConfig() and the duration estimate.
import { $, $$ } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { state } from '../../state.js';
import { icon } from '../../ui/icons.js';
import { m, tp } from '../../i18n.js';
import { ensureFontLoaded, downloadFont } from './fonts.js';
import { resRung, SUB_FIELDS, writeSubField, syncSubWeights, syncSubStudio, resetSubStudio, syncSubOut, buildSubColors, updateSubLaneHint, saveSubtitleDefaults, updateSubPreview, gatherSubFields } from './subtitle-studio.js';
import { fmtT, refreshFramePreview } from './frame-preview.js';
import { renderHfStyleButton, wireHfStyle } from './hf-style.js';
import { wireConfigGroups, updateCfgChips } from './groups.js';
import { wirePresetBar, renderSubPresetGrid, saveSubPreset } from './presets.js';

export function initConfig() {
  // SVG icons on group heads + preset bar (markup keeps emoji as no-JS fallback)
  const GRP_ICONS = { grpFormat: 'film', grpBrand: 'tv', grpSubtitle: 'subtitles', grpAudio: 'music', grpAdvanced: 'settings' };
  Object.entries(GRP_ICONS).forEach(([id, name]) => {
    const ic = document.querySelector(`#${id} .cfg-ic`); if (ic) ic.innerHTML = icon(name, 15);
  });
  $$('.cfg-arr').forEach((a) => { a.innerHTML = icon('edit', 13); });
  const ps = $('#btnPresetSave'); if (ps) ps.innerHTML = icon('save', 14);
  const pm = $('#btnPresetMenu'); if (pm) pm.innerHTML = icon('more', 14);
  const be = $('#btnBrandEditor'); if (be) be.innerHTML = `${icon('palette', 14)} ${m('Chỉnh Brand Kit của kênh…')}`;
  const cv = $('#btnCfgVoice'); if (cv) cv.innerHTML = `${icon('mic', 14)} ${m('Chọn giọng đọc (nghe thử)…')}`;
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
    ...gatherSubFields(),
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
export let applying = false;

/** Pour a saved subtitle bundle back into the panel, with the autosave held while every field is written. */
export function pourSubtitleBundle(mine) {
  applying = true;
  try {
    SUB_FIELDS.forEach((f) => writeSubField(f, mine.config));
    const p = mine.config.subtitleBoxPadding || {};
    [['#cfgSubPadTop', 'top', 14], ['#cfgSubPadRight', 'right', 28],
      ['#cfgSubPadBottom', 'bottom', 14], ['#cfgSubPadLeft', 'left', 28]]
      .forEach(([id, side, dflt]) => { if ($(id)) $(id).value = p[side] ?? dflt; });
    if (mine.config.subtitleFont) $('#cfgSubFont').value = mine.config.subtitleFont;
    if (mine.config.subtitleFontSize) { $('#cfgSubSize').value = mine.config.subtitleFontSize; $('#cfgSubSizeL').textContent = mine.config.subtitleFontSize; }
    $('#cfgSubCase').value = mine.config.subtitleTextCase || '';
    state.subColor = mine.config.subtitleColor || state.subColor;
    buildSubColors(); syncSubWeights(); syncSubStudio();
  } finally { applying = false; }
}

function applyConfigInner(cfg = {}) {
  state.hfStyleId = cfg.hyperframe?.styleId || 'tuila1-hud-cyber';
  state.hfGuide = cfg.hyperframe?.guide || null;
  if ($('#cfgHfDensity')) $('#cfgHfDensity').value = cfg.hyperframe?.density || 'balanced';
  if ($('#cfgHfDirection')) $('#cfgHfDirection').value = cfg.hyperframe?.direction || '';
  if ($('#cfgHfModel')) $('#cfgHfModel').value = cfg.hyperframe?.model || '';
  renderHfStyleButton();
  if (cfg.fps) $('#cfgFps').value = cfg.fps;
  if (cfg.resolutionScale) $('#cfgRes').value = String(resRung(cfg.resolutionScale));
  $('#cfgWatermark').value = cfg.watermarkText || '';
  if (cfg.aspectRatio) $('#cfgAr').value = cfg.aspectRatio;
  // UNCONDITIONAL, unlike its neighbours. This runs on every channel switch, so a guarded
  // `if (cfg.language)` would leave the picker showing the previous channel's language — and
  // gatherConfig would then PIN it onto a project that should have been auto.
  if ($('#cfgLang')) $('#cfgLang').value = cfg.language || 'auto';
  if (cfg.videoDuration) $('#cfgVd').value = cfg.videoDuration;
  if (cfg.sceneDuration) $('#cfgSd').value = cfg.sceneDuration;
  $('#cfgSub').checked = cfg.enableSubtitles !== false;
  // Only the 'change' handler used to fold the style section away, so a config that arrived with
  // subtitles OFF still displayed the whole preset gallery and the "apply to this video" button —
  // controls for something the video was not going to have.
  $('#subStyle').style.display = $('#cfgSub').checked ? 'block' : 'none';
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
  $('#cfgSubSizeL').textContent = $('#cfgSubSize').value;
  $('#cfgSubCase').value = cfg.subtitleTextCase || '';
  state.subColor = cfg.subtitleColor || '#F7B500';
  buildSubColors();
  $('#cfgSubPos').value = cfg.subtitlePosition?.preset || 'bot';
  SUB_FIELDS.forEach((f) => writeSubField(f, cfg));
  const pad = cfg.subtitleBoxPadding || {};
  [['#cfgSubPadTop', 'top', 14], ['#cfgSubPadRight', 'right', 28],
    ['#cfgSubPadBottom', 'bottom', 14], ['#cfgSubPadLeft', 'left', 28]]
    .forEach(([id, side, dflt]) => { if ($(id)) $(id).value = pad[side] ?? dflt; });
  syncSubStudio();
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
  // The studio's own controls, wired from the same table that gathers and restores them: one
  // listener rule, so a new setting cannot arrive without its autosave.
  SUB_FIELDS.forEach((f) => {
    const el = $(f.el);
    if (!el) return;
    const live = () => { syncSubOut(f); syncSubStudio(); updateSubPreview(); };
    el.addEventListener('input', live);
    el.addEventListener('change', () => { live(); saveSubtitleDefaults(); });
    // A colour input has no "unset" state of its own, so touching it is what marks it chosen —
    // otherwise every panel would ship whatever colour the picker happened to open on.
    if (f.t === 'color' || f.off === null) el.addEventListener('input', () => { el.dataset.set = '1'; });
  });
  ['#cfgSubPadTop', '#cfgSubPadRight', '#cfgSubPadBottom', '#cfgSubPadLeft'].forEach((id) => {
    $(id)?.addEventListener('change', () => { updateSubPreview(); saveSubtitleDefaults(); });
  });
  $('#cfgSubSize')?.addEventListener('input', () => { $('#cfgSubSizeL').textContent = $('#cfgSubSize').value; });
  $('#btnSubReset')?.addEventListener('click', resetSubStudio);
  $('#btnSubPresetSave')?.addEventListener('click', saveSubPreset);
  $('#cfgSub').addEventListener('change', () => $('#subStyle').style.display = $('#cfgSub').checked ? 'block' : 'none');
  $('#cfgSubChunk')?.addEventListener('change', () => $('#subWordsRow').classList.toggle('hidden', $('#cfgSubChunk').value !== 'words'));
  $('#cfgSubWords')?.addEventListener('input', () => { $('#cfgSubWordsL').textContent = $('#cfgSubWords').value; });
  // A font that has not been fetched would substitute in the preview AND in the video. Rather
  // than hiding it or letting it fail quietly, the picker offers to go and get it.
  $('#cfgSubFont')?.addEventListener('change', async () => {
    const fam = $('#cfgSubFont').value;
    const entry = (state.fontFamilies || []).find((f) => f.family === fam);
    $('#cfgSubFontGet')?.classList.toggle('hidden', !entry || entry.ready);
    syncSubWeights();
    await ensureFontLoaded(fam);
    updateSubPreview();
  });
  // Put the new subtitles on the video that already exists. Deliberately the same door as the
  // Brand Kit's: it opens the cost table, which starts the work and then shows the live log.
  $('#btnSubApply')?.addEventListener('click', async () => {
    const { openChangePlan } = await import('../../features/changeplan.js');
    await openChangePlan();
  });
  $('#btnFramePreview')?.addEventListener('click', refreshFramePreview);
  $('#framePreviewAt')?.addEventListener('input', () => { $('#framePreviewT').textContent = fmtT(+$('#framePreviewAt').value); });
  $('#framePreviewAt')?.addEventListener('change', refreshFramePreview);
  $('#cfgSubFontGet')?.addEventListener('click', async () => {
    const fam = $('#cfgSubFont').value;
    const btn = $('#cfgSubFontGet');
    btn.disabled = true; btn.textContent = m('⏳ Đang tải…');
    try {
      const r = await downloadFont(fam);
      toast(tp`🔤 Đã tải font ${r.family} (${r.faces} kiểu chữ, ${Math.round(r.bytes / 1024)}KB)`, 'success');
      $('#cfgSubFont').value = fam;
      btn.classList.add('hidden');
      saveSubtitleDefaults(); // setting .value fires no 'change' — the pick would go unsaved
    } catch (e) {
      toast(tp`✖ Không tải được font: ${e.message}`, 'error');
    } finally { btn.disabled = false; btn.textContent = m('⬇︎ Tải'); }
  });
}
export function updateEstimate() {
  const vd = +$('#cfgVd').value, sd = +$('#cfgSd').value;
  const auto = $('#cfgDurMode')?.value === 'auto';
  $('#cfgVd').disabled = auto;
  $('#cfgVd').closest('.field')?.classList.toggle('durmode-auto', auto);
  $('#cfgVdL').textContent = auto ? m('tự động') : (vd >= 60 ? tp`${Math.round(vd / 60 * 10) / 10} phút` : tp`${vd} giây`);
  $('#cfgSdL').textContent = tp`${sd} giây`;
  if (auto) {
    $('#cfgEst').textContent = m('🪄 Giữ NGUYÊN VĂN kịch bản bạn dán vào — thời lượng video = tổng lời thoại (cần ≥80 từ, nếu ngắn hơn sẽ chạy theo mục tiêu). ⚠ HyperFrame gọi AI theo TỪNG cảnh — kịch bản dài sẽ tốn chi phí tương ứng.');
    return;
  }
  const scenes = Math.max(1, Math.round(vd / sd));
  const hfWarn = scenes > 40
    ? tp` — ⚠ HyperFrame gọi AI cho từng cảnh (${scenes} lần): video dài sẽ tốn thời gian + chi phí` : '';
  // (sd − 0.65s nghỉ) × 4.4 wps × 0.95 — đúng công thức wordsForSlot của máy viết kịch bản (vi)
  const wpsScene = Math.max(8, Math.round((sd - 0.65) * 4.4 * 0.95));
  $('#cfgEst').textContent = tp`Ước tính ${scenes} cảnh, ~${wpsScene} từ/cảnh, tổng ~${scenes * wpsScene} từ${hfWarn}`;
}
