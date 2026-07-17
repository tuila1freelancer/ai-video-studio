import { $, esc } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state, activeChannelBrand } from '../state.js';
import { updateCfgChips } from '../views/config.js';

// Output resolution per aspect — mirrors src/util/util.js ratioToSize; drives the px readout
// (the numbers shown are the SAME integers ffmpeg receives — P26 WYSIWYG contract).
const RATIO_SIZE = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const SNAPS = [0.03, 1 / 3, 0.5, 2 / 3, 0.97]; // margins, thirds, center

export function refreshBrandSummary() {
  const bk = activeChannelBrand();
  const th = $('#bsThumb'), nm = $('#bsName'), mt = $('#bsMeta');
  if (!th) return;
  if (bk) {
    th.innerHTML = bk.logo?.assetPath ? `<img src="${fileUrl(bk.logo.assetPath)}">` : '🏷';
    nm.textContent = bk.channelName || 'Brand kit (chỉ logo)';
    const pl = bk.placement === 'always' ? 'cố định' : bk.placement === 'off' ? 'tắt'
      : bk.placement === 'final' ? 'đóng dấu cả video' : 'thông minh';
    mt.textContent = `Chèn: ${pl}${bk.logo ? ' · có logo' : ''}`;
  } else {
    th.textContent = '🏷'; nm.textContent = 'Chưa cấu hình brand';
    mt.textContent = 'Logo + tên kênh sẽ tự chèn vào từng cảnh';
  }
  const lw = $('#legacyWatermark'); if (lw) lw.style.display = bk ? 'none' : 'block';
  updateCfgChips();
}

const isFinal = () => state.brandDraft?.placement === 'final';
const arValue = () => $('#cfgAr')?.value || '9:16';

export function openBrandEditor() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  if (!ch) return toast('Chưa có kênh đang chọn.', 'error');
  const bk = ch.config?.brandKit || {};
  const fo = bk.finalOverlay || {};
  state.brandDraft = {
    channelName: bk.channelName || ch.name || '',
    placement: bk.placement || 'smart',
    logo: bk.logo ? { ...bk.logo, position: { ...(bk.logo.position || { xPct: 0.92, yPct: 0.06 }) } } : null,
    // final-overlay draft keeps a drag-compatible {xPct,yPct}; save maps it back to cx/cy
    finalOverlay: {
      position: { xPct: Number.isFinite(+fo.cxPct) ? +fo.cxPct : 0.92, yPct: Number.isFinite(+fo.cyPct) ? +fo.cyPct : 0.08 },
      wPct: Number.isFinite(+fo.wPct) ? +fo.wPct : 0.085,
      opacity: Number.isFinite(+fo.opacity) ? +fo.opacity : 0.9,
    },
    nameBadge: {
      enabled: bk.nameBadge ? bk.nameBadge.enabled !== false : true,
      style: bk.nameBadge?.style || 'plain',
      position: { ...(bk.nameBadge?.position || { xPct: 0.5, yPct: 0.045 }) },
    },
    stickers: bk.stickers || [],
  };
  $('#brandChName').textContent = ch.name;
  $('#brandName').value = state.brandDraft.channelName;
  $('#brandPlacement').value = state.brandDraft.placement;
  $('#brandBadgeOn').checked = state.brandDraft.nameBadge.enabled;
  $('#brandBadgeStyle').value = state.brandDraft.nameBadge.style;
  $('#brandLogoStyle').value = state.brandDraft.logo?.style || 'plain';
  // per-channel AI overrides (compact)
  const ai = ch.config?.ai || {};
  $('#brandAiTts').innerHTML = '<option value="">— Dùng cấu hình chung —</option>'
    + (state.providers || []).map((p) => `<option value="${p.id}"${ai.tts?.provider === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#brandAiLlmModel').value = ai.llm?.model || '';
  $('#brandAiSub').value = ai.subtitle?.engine || '';
  // channel brand font (drives graphics typography in every new video of the channel)
  api.get('/fonts/families').then(({ families }) => {
    const sel = $('#brandFont');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Theo style guide —</option>'
      + (families || []).map((f) => `<option value="${esc(f.name)}">${f.source === 'uploaded' ? '📤 ' : ''}${esc(f.name)}</option>`).join('');
    sel.value = ch.config?.fonts?.display || '';
  }).catch(() => { /* picker just stays on the default option */ });
  // stage: true output aspect (all four ratios), latest real frame as backdrop,
  // checkerboard when none so a transparent logo still reads clearly
  const stage = $('#brandStage');
  const ar = arValue();
  stage.classList.remove('landscape');
  stage.style.aspectRatio = ar.replace(':', '/');
  stage.style.maxHeight = ({ '16:9': '260px', '1:1': '340px', '4:5': '380px' })[ar] || '430px';
  const proj = state.projects.find((p) => p.thumb_path) || null;
  const scenePrev = state.scenes.find((s) => s.image_path)?.image_path;
  const bg = scenePrev ? `url('${fileUrl(scenePrev)}')` : (proj ? `url('${fileUrl(proj.thumb_path)}')` : '');
  stage.style.backgroundImage = bg;
  stage.classList.toggle('checker', !bg);
  applySliderMode();
  syncBrandStage();
  $('#brandModal').classList.add('open');
}

// The size/opacity sliders serve BOTH lanes: per-scene sizePct (4–20% of min-dim) and the
// final overlay's free wPct (2–40% of frame WIDTH). Re-range on placement switch.
function applySliderMode() {
  const d = state.brandDraft; if (!d) return;
  const s = $('#brandLogoSize'), o = $('#brandLogoOpacity');
  if (isFinal()) {
    s.min = 2; s.max = 40; s.step = 0.5; s.value = d.finalOverlay.wPct * 100;
    o.value = Math.round(d.finalOverlay.opacity * 100);
  } else {
    s.min = 4; s.max = 20; s.step = 0.5; s.value = d.logo?.sizePct ?? 8.5;
    o.value = Math.round((d.logo?.opacity ?? 0.9) * 100);
  }
}

function syncBrandStage() {
  const d = state.brandDraft; if (!d) return;
  const logoEl = $('#bstLogo'), badgeEl = $('#bstBadge');
  if (d.logo?.assetPath) {
    logoEl.classList.remove('hidden');
    $('#bstLogoImg').src = fileUrl(d.logo.assetPath);
    if (isFinal()) {
      // EXACT preview: width = wPct of the stage (= of the frame), center-anchored ghost —
      // the identical formula logoRect uses server-side. No approximation in this lane.
      logoEl.style.left = (d.finalOverlay.position.xPct * 100) + '%';
      logoEl.style.top = (d.finalOverlay.position.yPct * 100) + '%';
      logoEl.style.width = (d.finalOverlay.wPct * 100) + '%';
      logoEl.style.opacity = d.finalOverlay.opacity;
    } else {
      logoEl.style.left = (d.logo.position.xPct * 100) + '%';
      logoEl.style.top = (d.logo.position.yPct * 100) + '%';
      logoEl.style.width = (d.logo.sizePct * 1.6) + '%'; // stage is min-dim scaled; approx for editing
      logoEl.style.opacity = d.logo.opacity;
    }
  } else logoEl.classList.add('hidden');
  if (d.nameBadge.enabled && (d.channelName || '').trim()) {
    badgeEl.classList.remove('hidden');
    badgeEl.textContent = (d.channelName || 'TÊN KÊNH').toUpperCase();
    badgeEl.style.left = (d.nameBadge.position.xPct * 100) + '%';
    badgeEl.style.top = (d.nameBadge.position.yPct * 100) + '%';
  } else badgeEl.classList.add('hidden');
  if (isFinal()) {
    $('#brandLogoSizeL').textContent = (d.finalOverlay.wPct * 100).toFixed(1) + '% rộng khung';
    $('#brandLogoOpacityL').textContent = Math.round(d.finalOverlay.opacity * 100) + '%';
  } else {
    $('#brandLogoSizeL').textContent = (d.logo?.sizePct ?? 8.5) + '%';
    $('#brandLogoOpacityL').textContent = Math.round((d.logo?.opacity ?? 0.9) * 100) + '%';
  }
  updateReadout();
}

// px readout under the stage — mirror of src/media/logo-overlay.js logoRect (P26).
function updateReadout() {
  const el = $('#bstReadout'); if (!el) return;
  const d = state.brandDraft;
  if (!isFinal()) { el.textContent = ''; return; }
  if (!d?.logo?.assetPath) { el.textContent = 'Tải logo lên để đóng dấu cả video.'; return; }
  const [W, H] = RATIO_SIZE[arValue()] || RATIO_SIZE['9:16'];
  const img = $('#bstLogoImg');
  const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const fo = d.finalOverlay;
  const lw = Math.round(fo.wPct * W), lh = Math.round(lw * (ih / iw));
  const x = Math.round(fo.position.xPct * W - lw / 2), y = Math.round(fo.position.yPct * H - lh / 2);
  el.textContent = `Render: x=${x}px · y=${y}px · logo ${lw}×${lh}px @ ${W}×${H}`;
}

const snapTo = (v) => { for (const s of SNAPS) if (Math.abs(v - s) < 0.012) return s; return null; };

// pointer-drag ghosts → xPct/yPct (center-based, clamped); final mode adds snap guides
function wireBrandDrag(el, getPos, { snap } = {}) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList?.contains('bst-rsz')) return; // the resize handle owns its gesture
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const stage = $('#brandStage').getBoundingClientRect();
    const gv = $('#bstGuideV'), gh = $('#bstGuideH');
    const move = (ev) => {
      const pos = getPos(); if (!pos) return;
      let x = Math.min(0.98, Math.max(0.02, (ev.clientX - stage.left) / stage.width));
      let y = Math.min(0.98, Math.max(0.02, (ev.clientY - stage.top) / stage.height));
      if (snap && snap()) {
        const sx = snapTo(x), sy = snapTo(y);
        if (sx != null) { x = sx; gv.style.left = (sx * 100) + '%'; gv.style.display = 'block'; } else gv.style.display = 'none';
        if (sy != null) { y = sy; gh.style.top = (sy * 100) + '%'; gh.style.display = 'block'; } else gh.style.display = 'none';
      }
      pos.xPct = x; pos.yPct = y;
      syncBrandStage();
    };
    const up = () => {
      el.classList.remove('drag');
      if (gv) gv.style.display = 'none';
      if (gh) gh.style.display = 'none';
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

function setSize(valuePct) {
  const d = state.brandDraft; if (!d) return;
  if (isFinal()) d.finalOverlay.wPct = Math.min(0.4, Math.max(0.02, valuePct / 100));
  else if (d.logo) d.logo.sizePct = Math.min(20, Math.max(4, valuePct));
  syncBrandStage();
}
function nudgeSize(deltaPct) {
  const d = state.brandDraft; if (!d) return;
  const cur = isFinal() ? d.finalOverlay.wPct * 100 : (d.logo?.sizePct ?? 8.5);
  setSize(cur + deltaPct);
  applySliderMode();
}

export function initBrandKit() {
  const be = $('#btnBrandEditor');
  if (!be) return;
  be.addEventListener('click', openBrandEditor);
  wireBrandDrag($('#bstLogo'),
    () => (isFinal() ? state.brandDraft?.finalOverlay?.position : state.brandDraft?.logo?.position),
    { snap: isFinal });
  wireBrandDrag($('#bstBadge'), () => state.brandDraft?.nameBadge?.position);
  // free resize: wheel over the ghost (±0.5%, shift ±2%) + corner handle drag
  $('#bstLogo').addEventListener('wheel', (e) => {
    e.preventDefault();
    nudgeSize((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 2 : 0.5));
  }, { passive: false });
  $('#bstRsz').addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const h = $('#bstRsz');
    h.setPointerCapture(e.pointerId);
    const stage = $('#brandStage').getBoundingClientRect();
    const startX = e.clientX;
    const start = isFinal() ? state.brandDraft.finalOverlay.wPct * 100 : (state.brandDraft.logo?.sizePct ?? 8.5);
    const move = (ev) => {
      const delta = ((ev.clientX - startX) / stage.width) * 100;
      setSize(start + (isFinal() ? delta : delta * 0.6));
      applySliderMode();
    };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  });
  // keyboard nudge on the focused ghost: arrows ±0.5%, shift+arrows ±2%
  $('#bstLogo').addEventListener('keydown', (e) => {
    const d = state.brandDraft; if (!d?.logo) return;
    const pos = isFinal() ? d.finalOverlay.position : d.logo.position;
    const step = (e.shiftKey ? 2 : 0.5) / 100;
    let handled = true;
    if (e.key === 'ArrowLeft') pos.xPct = Math.max(0.02, pos.xPct - step);
    else if (e.key === 'ArrowRight') pos.xPct = Math.min(0.98, pos.xPct + step);
    else if (e.key === 'ArrowUp') pos.yPct = Math.max(0.02, pos.yPct - step);
    else if (e.key === 'ArrowDown') pos.yPct = Math.min(0.98, pos.yPct + step);
    else handled = false;
    if (handled) { e.preventDefault(); syncBrandStage(); }
  });
  $('#bstLogoImg').addEventListener('load', updateReadout);
  $('#brandName').addEventListener('input', () => { state.brandDraft.channelName = $('#brandName').value; syncBrandStage(); });
  $('#brandBadgeOn').addEventListener('change', () => { state.brandDraft.nameBadge.enabled = $('#brandBadgeOn').checked; syncBrandStage(); });
  $('#brandBadgeStyle').addEventListener('change', () => { state.brandDraft.nameBadge.style = $('#brandBadgeStyle').value; });
  $('#brandPlacement').addEventListener('change', () => {
    state.brandDraft.placement = $('#brandPlacement').value;
    applySliderMode();
    syncBrandStage();
  });
  $('#brandLogoSize').addEventListener('input', () => setSize(+$('#brandLogoSize').value));
  $('#brandLogoOpacity').addEventListener('input', () => {
    const v = +$('#brandLogoOpacity').value / 100;
    if (isFinal()) state.brandDraft.finalOverlay.opacity = v;
    else if (state.brandDraft.logo) state.brandDraft.logo.opacity = v;
    syncBrandStage();
  });
  $('#brandLogoStyle').addEventListener('change', () => { if (state.brandDraft.logo) state.brandDraft.logo.style = $('#brandLogoStyle').value; });
  $('#brandLogoClear').addEventListener('click', () => { state.brandDraft.logo = null; syncBrandStage(); });
  $('#brandLogoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await api.upload(`/channels/${state.activeChannel}/brand-logo`, fd);
    if (r.error) return toast(r.error, 'error');
    state.brandDraft.logo = {
      assetPath: r.path, position: state.brandDraft.logo?.position || { xPct: 0.92, yPct: 0.06 },
      sizePct: isFinal() ? 8.5 : +$('#brandLogoSize').value,
      opacity: +$('#brandLogoOpacity').value / 100, style: $('#brandLogoStyle').value,
    };
    syncBrandStage();
    toast('🖼 Logo đã tải lên', 'success');
  });
  $('#brandSave').addEventListener('click', async () => {
    const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
    if (!ch || !state.brandDraft) return;
    const d = state.brandDraft;
    const brandKit = {
      channelName: d.channelName.trim(),
      placement: d.placement,
      logo: d.logo, nameBadge: { ...d.nameBadge, text: undefined }, stickers: d.stickers,
      finalOverlay: {
        enabled: d.placement === 'final',
        cxPct: d.finalOverlay.position.xPct, cyPct: d.finalOverlay.position.yPct,
        wPct: d.finalOverlay.wPct, opacity: d.finalOverlay.opacity,
      },
    };
    const ai = {};
    if ($('#brandAiTts').value) ai.tts = { ...(ch.config?.ai?.tts || {}), provider: $('#brandAiTts').value };
    if ($('#brandAiLlmModel').value.trim()) ai.llm = { ...(ch.config?.ai?.llm || {}), model: $('#brandAiLlmModel').value.trim() };
    if ($('#brandAiSub').value) ai.subtitle = { engine: $('#brandAiSub').value };
    const cfg = { ...(ch.config || {}), brandKit };
    cfg.ai = Object.keys(ai).length ? ai : null; // null = xoá override AI của kênh (deep-merge delete)
    cfg.fonts = $('#brandFont')?.value ? { display: $('#brandFont').value } : null;
    const r = await api.put(`/channels/${ch.id}`, { config: cfg });
    if (r.error) return toast(r.error, 'error');
    ch.config = r.channel.config;
    closeModal('#brandModal');
    refreshBrandSummary();
    toast('🏷 Brand Kit đã lưu — mọi video mới của kênh sẽ tự gắn brand', 'success');
  });
}
