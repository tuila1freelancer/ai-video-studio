// Brand Kit editor — three fixed, WYSIWYG lanes (owner order 2026-07-17: smart placement
// removed as impractical):
//   • channel-name badge: per-scene chrome at a dragged fixed position
//   • logo stamp (P26): burned ONCE at final concat — corner presets or free drag,
//     preview mirrors logoRect exactly (same fractions, same integers in the readout)
//   • copyright watermark (P28): logo/name drifting slowly around the perimeter — the
//     preview animates the SAME perimeterPos path the ffmpeg expressions encode (×5 speed)
import { $, $$, esc } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state, activeChannelBrand } from '../state.js';
import { updateCfgChips } from '../views/config.js';

// Output resolution per aspect — mirrors src/util/util.js ratioToSize (P26 readout numbers).
const RATIO_SIZE = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const SNAPS = [0.03, 1 / 3, 0.5, 2 / 3, 0.97]; // margins, thirds, center
const CORNER_GAP = 0.025;    // stamp corner presets: gap = 2.5% of min(W,H) — "sát mép một xíu"
const WM_MARGIN = 0.02;      // watermark path margin — mirrors media/watermark.js marginPct
const WM_PERIODS = { slower: 120, slow: 75, medium: 45 };
const WM_PREVIEW_SPEED = 5;  // preview runs ×5 so the drift is visible while editing

export function refreshBrandSummary() {
  const bk = activeChannelBrand();
  const th = $('#bsThumb'), nm = $('#bsName'), mt = $('#bsMeta');
  if (!th) return;
  if (bk) {
    th.innerHTML = bk.logo?.assetPath ? `<img src="${fileUrl(bk.logo.assetPath)}">` : '🏷';
    nm.textContent = bk.channelName || 'Brand kit (chỉ logo)';
    const bits = [];
    if (bk.finalOverlay?.enabled && bk.logo?.assetPath) bits.push('đóng dấu logo');
    if (bk.watermark?.enabled) bits.push('watermark trôi');
    if (bk.nameBadge?.enabled !== false && bk.channelName) bits.push('tên kênh');
    mt.textContent = bits.length ? `Cố định: ${bits.join(' · ')}` : 'Chưa bật thành phần nào';
  } else {
    th.textContent = '🏷'; nm.textContent = 'Chưa cấu hình brand';
    mt.textContent = 'Logo đóng dấu + watermark + tên kênh (đều cố định, WYSIWYG)';
  }
  const lw = $('#legacyWatermark'); if (lw) lw.style.display = bk ? 'none' : 'block';
  updateCfgChips();
}

const arValue = () => $('#cfgAr')?.value || '9:16';
const frameWH = () => RATIO_SIZE[arValue()] || RATIO_SIZE['9:16'];

let wmRaf = 0; // watermark preview animation handle

export function openBrandEditor() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  if (!ch) return toast('Chưa có kênh đang chọn.', 'error');
  const bk = ch.config?.brandKit || {};
  const fo = bk.finalOverlay || null;
  const [W, H] = frameWH();
  // Legacy migration (pre-stamp configs): placement smart/always carried a per-scene logo —
  // map its geometry onto the stamp so the owner's logo survives the smart-lane removal.
  const legacyStamp = !fo && bk.logo?.assetPath && bk.placement && bk.placement !== 'off';
  state.brandDraft = {
    channelName: bk.channelName || ch.name || '',
    logo: bk.logo?.assetPath ? { assetPath: bk.logo.assetPath } : null,
    badge: {
      enabled: bk.placement === 'off' ? false : (bk.nameBadge ? bk.nameBadge.enabled !== false : true),
      style: bk.nameBadge?.style || 'plain',
      position: { ...(bk.nameBadge?.position || { xPct: 0.5, yPct: 0.045 }) },
    },
    stamp: {
      enabled: fo ? fo.enabled === true : legacyStamp,
      position: fo
        ? { xPct: num(fo.cxPct, 0.92), yPct: num(fo.cyPct, 0.08) }
        : { xPct: num(bk.logo?.position?.xPct, 0.92), yPct: num(bk.logo?.position?.yPct, 0.08) },
      wPct: fo ? num(fo.wPct, 0.085)
        : Math.min(0.4, Math.max(0.02, ((bk.logo?.sizePct || 8.5) / 100) * (Math.min(W, H) / W))),
      opacity: num(fo ? fo.opacity : bk.logo?.opacity, 0.9),
    },
    watermark: {
      enabled: bk.watermark?.enabled === true,
      source: bk.watermark?.source === 'name' ? 'name' : 'logo',
      speed: WM_PERIODS[bk.watermark?.speed] ? bk.watermark.speed : 'slow',
      opacity: num(bk.watermark?.opacity, 0.35),
      logoSizePct: Math.min(20, Math.max(3, num(bk.watermark?.wPct, 0.06) * 100)),
      textSizePct: Math.min(6, Math.max(1.8, num(bk.watermark?.hPct, 0.028) * 100)),
    },
    stickers: bk.stickers || [],
  };
  const d = state.brandDraft;
  $('#brandChName').textContent = ch.name;
  $('#brandName').value = d.channelName;
  $('#brandBadgeOn').checked = d.badge.enabled;
  $('#brandBadgeStyle').value = d.badge.style;
  $('#stampOn').checked = d.stamp.enabled;
  $('#wmOn').checked = d.watermark.enabled;
  $('#wmSource').value = d.watermark.source;
  $('#wmSpeed').value = d.watermark.speed;
  $('#wmOpacity').value = Math.round(d.watermark.opacity * 100);
  // per-channel AI overrides (compact)
  const ai = ch.config?.ai || {};
  $('#brandAiTts').innerHTML = '<option value="">— Dùng cấu hình chung —</option>'
    + (state.providers || []).map((p) => `<option value="${p.id}"${ai.tts?.provider === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#brandAiLlmModel').value = ai.llm?.model || '';
  $('#brandAiSub').value = ai.subtitle?.engine || '';
  api.get('/fonts/families').then(({ families }) => {
    const sel = $('#brandFont');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Theo style guide —</option>'
      + (families || []).map((f) => `<option value="${esc(f.name)}">${f.source === 'uploaded' ? '📤 ' : ''}${esc(f.name)}</option>`).join('');
    sel.value = ch.config?.fonts?.display || '';
  }).catch(() => { /* picker just stays on the default option */ });
  // stage: true render aspect, latest real frame as backdrop, checkerboard when none
  const stage = $('#brandStage');
  const ar = arValue();
  stage.classList.toggle('landscape', ar === '16:9');
  stage.style.aspectRatio = ar.replace(':', '/');
  stage.style.maxHeight = ({ '16:9': '42vh', '1:1': '52vh', '4:5': '58vh' })[ar] || '66vh';
  const proj = state.projects.find((p) => p.thumb_path) || null;
  const scenePrev = state.scenes.find((s) => s.image_path)?.image_path;
  const bg = scenePrev ? `url('${fileUrl(scenePrev)}')` : (proj ? `url('${fileUrl(proj.thumb_path)}')` : '');
  stage.style.backgroundImage = bg;
  stage.classList.toggle('checker', !bg);
  $('#bstStageMeta').textContent = `Khung xem trước đúng tỉ lệ render: ${W}×${H} (${ar})`;
  applyControlState();
  syncBrandStage();
  startWmPreview();
  $('#brandModal').classList.add('open');
}

const num = (v, dflt) => (Number.isFinite(+v) ? +v : dflt);

// show/hide option groups + slider values that follow the draft
function applyControlState() {
  const d = state.brandDraft; if (!d) return;
  $('#stampOpts').style.display = d.stamp.enabled ? '' : 'none';
  $('#wmOpts').classList.toggle('hidden', !d.watermark.enabled);
  $('#brandLogoSize').value = d.stamp.wPct * 100;
  $('#brandLogoOpacity').value = Math.round(d.stamp.opacity * 100);
  const s = $('#wmSize');
  if (d.watermark.source === 'logo') { s.min = 3; s.max = 20; s.step = 0.5; s.value = d.watermark.logoSizePct; }
  else { s.min = 1.8; s.max = 6; s.step = 0.2; s.value = d.watermark.textSizePct; }
}

function syncBrandStage() {
  const d = state.brandDraft; if (!d) return;
  const logoEl = $('#bstLogo'), badgeEl = $('#bstBadge');
  if (d.logo?.assetPath) {
    logoEl.classList.remove('hidden');
    logoEl.classList.toggle('bst-dim', !d.stamp.enabled);
    $('#bstLogoImg').src = fileUrl(d.logo.assetPath);
    // EXACT preview: width = wPct of the stage (= of the frame), center-anchored ghost —
    // the identical formula logoRect uses server-side (P26).
    logoEl.style.left = (d.stamp.position.xPct * 100) + '%';
    logoEl.style.top = (d.stamp.position.yPct * 100) + '%';
    logoEl.style.width = (d.stamp.wPct * 100) + '%';
    logoEl.style.opacity = d.stamp.enabled ? d.stamp.opacity : 0.9;
  } else logoEl.classList.add('hidden');
  if (d.badge.enabled && (d.channelName || '').trim()) {
    badgeEl.classList.remove('hidden');
    badgeEl.textContent = (d.channelName || 'TÊN KÊNH').toUpperCase();
    badgeEl.style.left = (d.badge.position.xPct * 100) + '%';
    badgeEl.style.top = (d.badge.position.yPct * 100) + '%';
  } else badgeEl.classList.add('hidden');
  $('#brandLogoSizeL').textContent = (d.stamp.wPct * 100).toFixed(1) + '% rộng khung';
  $('#brandLogoOpacityL').textContent = Math.round(d.stamp.opacity * 100) + '%';
  $('#wmOpacityL').textContent = Math.round(d.watermark.opacity * 100) + '%';
  const wmSize = d.watermark.source === 'logo' ? d.watermark.logoSizePct : d.watermark.textSizePct;
  $('#wmSizeL').textContent = (+wmSize).toFixed(1).replace(/\.0$/, '') + '%';
  markActiveCorner();
  updateReadout();
  syncWmGhost();
}

// px readout under the stage — mirror of src/media/logo-overlay.js logoRect (P26).
function updateReadout() {
  const el = $('#bstReadout'); if (!el) return;
  const d = state.brandDraft;
  if (!d?.stamp.enabled) { el.textContent = ''; return; }
  if (!d?.logo?.assetPath) { el.textContent = 'Tải logo lên để đóng dấu.'; return; }
  const [W, H] = frameWH();
  const img = $('#bstLogoImg');
  const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const lw = Math.round(d.stamp.wPct * W), lh = Math.round(lw * (ih / iw));
  const x = Math.round(d.stamp.position.xPct * W - lw / 2), y = Math.round(d.stamp.position.yPct * H - lh / 2);
  el.textContent = `Đóng dấu: x=${x}px · y=${y}px · logo ${lw}×${lh}px @ ${W}×${H}`;
}

// ---- corner presets: logo box edges sit CORNER_GAP·min(W,H) from the frame edges ----
function cornerCenter(corner) {
  const d = state.brandDraft;
  const [W, H] = frameWH();
  const img = $('#bstLogoImg');
  const ar = (img.naturalHeight || 1) / (img.naturalWidth || 1);
  const w = d.stamp.wPct;                    // width fraction of W
  const h = w * (W / H) * ar;                // height fraction of H
  const gx = CORNER_GAP * Math.min(W, H) / W, gy = CORNER_GAP * Math.min(W, H) / H;
  const cx = corner[1] === 'l' ? gx + w / 2 : 1 - gx - w / 2;
  const cy = corner[0] === 't' ? gy + h / 2 : 1 - gy - h / 2;
  return { xPct: cx, yPct: cy };
}
function markActiveCorner() {
  const d = state.brandDraft; if (!d) return;
  let active = 'free';
  for (const c of ['tl', 'tr', 'bl', 'br']) {
    const p = cornerCenter(c);
    if (Math.abs(p.xPct - d.stamp.position.xPct) < 0.006 && Math.abs(p.yPct - d.stamp.position.yPct) < 0.006) { active = c; break; }
  }
  $$('#stampCorners button').forEach((b) => b.classList.toggle('active', b.dataset.corner === active));
}

// ---- watermark preview: SAME perimeter path as media/watermark.js, at ×5 speed ----
function perimeterPos(u, { bw, bh, mx, my }) {
  const x0 = mx, x1 = Math.max(mx, 1 - mx - bw), y0 = my, y1 = Math.max(my, 1 - my - bh);
  const px = x1 - x0, py = y1 - y0;
  const t = ((u % 1) + 1) % 1;
  if (t < 0.25) return { x: x0 + px * (t / 0.25), y: y0 };
  if (t < 0.5) return { x: x1, y: y0 + py * ((t - 0.25) / 0.25) };
  if (t < 0.75) return { x: x1 - px * ((t - 0.5) / 0.25), y: y1 };
  return { x: x0, y: y1 - py * ((t - 0.75) / 0.25) };
}
function syncWmGhost() {
  const d = state.brandDraft;
  const wmEl = $('#bstWm'), img = $('#bstWmImg'), txt = $('#bstWmText');
  const useLogo = d.watermark.source === 'logo' && d.logo?.assetPath;
  const name = (d.channelName || '').trim();
  if (!d.watermark.enabled || (!useLogo && !name)) { wmEl.classList.add('hidden'); return; }
  wmEl.classList.remove('hidden');
  wmEl.style.opacity = d.watermark.opacity;
  img.classList.toggle('hidden', !useLogo);
  txt.classList.toggle('hidden', !!useLogo);
  if (useLogo) {
    img.src = fileUrl(d.logo.assetPath);
    wmEl.style.width = d.watermark.logoSizePct + '%';
  } else {
    wmEl.style.width = 'auto';
    txt.textContent = name + ' ©';
    const stageH = $('#brandStage').getBoundingClientRect().height || 1;
    txt.style.fontSize = Math.max(8, stageH * d.watermark.textSizePct / 100) + 'px';
  }
}
function startWmPreview() {
  cancelAnimationFrame(wmRaf);
  const tick = () => {
    const d = state.brandDraft;
    const wmEl = $('#bstWm');
    if (d && d.watermark.enabled && !wmEl.classList.contains('hidden') && $('#brandModal').classList.contains('open')) {
      const [W, H] = frameWH();
      const stage = $('#brandStage').getBoundingClientRect();
      const bw = (wmEl.offsetWidth || 1) / (stage.width || 1);
      const bh = (wmEl.offsetHeight || 1) / (stage.height || 1);
      const mx = WM_MARGIN * Math.min(W, H) / W, my = WM_MARGIN * Math.min(W, H) / H;
      const P = WM_PERIODS[d.watermark.speed] || 75;
      const u = ((performance.now() / 1000) * WM_PREVIEW_SPEED % P) / P;
      const p = perimeterPos(u, { bw, bh, mx, my });
      wmEl.style.left = (p.x * 100) + '%';
      wmEl.style.top = (p.y * 100) + '%';
    }
    wmRaf = requestAnimationFrame(tick);
  };
  wmRaf = requestAnimationFrame(tick);
}

const snapTo = (v) => { for (const s of SNAPS) if (Math.abs(v - s) < 0.012) return s; return null; };

// pointer-drag ghosts → xPct/yPct (center-based, clamped); the stamp gets snap guides
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
      if (snap) {
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

function setStampSize(valuePct) {
  const d = state.brandDraft; if (!d) return;
  d.stamp.wPct = Math.min(0.4, Math.max(0.02, valuePct / 100));
  syncBrandStage();
}

export function initBrandKit() {
  const be = $('#btnBrandEditor');
  if (!be) return;
  be.addEventListener('click', openBrandEditor);
  wireBrandDrag($('#bstLogo'), () => state.brandDraft?.stamp?.position, { snap: true });
  wireBrandDrag($('#bstBadge'), () => state.brandDraft?.badge?.position);
  // free resize: wheel over the ghost (±0.5%, shift ±2%) + corner handle drag
  $('#bstLogo').addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = state.brandDraft; if (!d) return;
    setStampSize(d.stamp.wPct * 100 + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 2 : 0.5));
    applyControlState();
  }, { passive: false });
  $('#bstRsz').addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const h = $('#bstRsz');
    h.setPointerCapture(e.pointerId);
    const stage = $('#brandStage').getBoundingClientRect();
    const startX = e.clientX;
    const start = state.brandDraft.stamp.wPct * 100;
    const move = (ev) => { setStampSize(start + ((ev.clientX - startX) / stage.width) * 100); applyControlState(); };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  });
  // keyboard nudge on the focused ghost: arrows ±0.5%, shift+arrows ±2%
  $('#bstLogo').addEventListener('keydown', (e) => {
    const d = state.brandDraft; if (!d?.logo) return;
    const pos = d.stamp.position;
    const step = (e.shiftKey ? 2 : 0.5) / 100;
    let handled = true;
    if (e.key === 'ArrowLeft') pos.xPct = Math.max(0.02, pos.xPct - step);
    else if (e.key === 'ArrowRight') pos.xPct = Math.min(0.98, pos.xPct + step);
    else if (e.key === 'ArrowUp') pos.yPct = Math.max(0.02, pos.yPct - step);
    else if (e.key === 'ArrowDown') pos.yPct = Math.min(0.98, pos.yPct + step);
    else handled = false;
    if (handled) { e.preventDefault(); syncBrandStage(); }
  });
  $('#bstLogoImg').addEventListener('load', syncBrandStage);
  // corner presets — "sát mép, cách một khoảng rất nhỏ"; 🎯 = focus the ghost for dragging
  $$('#stampCorners button').forEach((b) => b.addEventListener('click', () => {
    const d = state.brandDraft; if (!d) return;
    if (!d.logo?.assetPath) return toast('Tải logo lên trước đã.', 'error');
    if (b.dataset.corner === 'free') { $('#bstLogo').focus(); return; }
    d.stamp.position = cornerCenter(b.dataset.corner);
    syncBrandStage();
  }));
  $('#brandName').addEventListener('input', () => { state.brandDraft.channelName = $('#brandName').value; syncBrandStage(); });
  $('#brandBadgeOn').addEventListener('change', () => { state.brandDraft.badge.enabled = $('#brandBadgeOn').checked; syncBrandStage(); });
  $('#brandBadgeStyle').addEventListener('change', () => { state.brandDraft.badge.style = $('#brandBadgeStyle').value; });
  $('#stampOn').addEventListener('change', () => {
    state.brandDraft.stamp.enabled = $('#stampOn').checked;
    applyControlState(); syncBrandStage();
  });
  $('#brandLogoSize').addEventListener('input', () => setStampSize(+$('#brandLogoSize').value));
  $('#brandLogoOpacity').addEventListener('input', () => {
    state.brandDraft.stamp.opacity = +$('#brandLogoOpacity').value / 100;
    syncBrandStage();
  });
  // watermark controls
  $('#wmOn').addEventListener('change', () => {
    state.brandDraft.watermark.enabled = $('#wmOn').checked;
    applyControlState(); syncBrandStage();
  });
  $('#wmSource').addEventListener('change', () => {
    state.brandDraft.watermark.source = $('#wmSource').value;
    applyControlState(); syncBrandStage();
  });
  $('#wmSpeed').addEventListener('change', () => { state.brandDraft.watermark.speed = $('#wmSpeed').value; });
  $('#wmSize').addEventListener('input', () => {
    const d = state.brandDraft, v = +$('#wmSize').value;
    if (d.watermark.source === 'logo') d.watermark.logoSizePct = v; else d.watermark.textSizePct = v;
    syncBrandStage();
  });
  $('#wmOpacity').addEventListener('input', () => {
    state.brandDraft.watermark.opacity = +$('#wmOpacity').value / 100;
    syncBrandStage();
  });
  $('#brandLogoClear').addEventListener('click', () => { state.brandDraft.logo = null; syncBrandStage(); });
  $('#brandLogoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await api.upload(`/channels/${state.activeChannel}/brand-logo`, fd);
    if (r.error) return toast(r.error, 'error');
    state.brandDraft.logo = { assetPath: r.path };
    if (!$('#stampOn').checked) { $('#stampOn').checked = true; state.brandDraft.stamp.enabled = true; applyControlState(); }
    syncBrandStage();
    toast('🖼 Logo đã tải lên', 'success');
  });
  $('#brandSave').addEventListener('click', async () => {
    const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
    if (!ch || !state.brandDraft) return;
    const d = state.brandDraft;
    const brandKit = {
      channelName: d.channelName.trim(),
      placement: null, // PUT deep-merges — null explicitly deletes the legacy smart/always key
      logo: d.logo,
      nameBadge: { enabled: d.badge.enabled, style: d.badge.style, position: d.badge.position },
      stickers: d.stickers,
      finalOverlay: {
        enabled: d.stamp.enabled && !!d.logo,
        cxPct: d.stamp.position.xPct, cyPct: d.stamp.position.yPct,
        wPct: d.stamp.wPct, opacity: d.stamp.opacity,
      },
      watermark: {
        enabled: d.watermark.enabled,
        source: d.watermark.source, speed: d.watermark.speed, opacity: d.watermark.opacity,
        wPct: d.watermark.logoSizePct / 100, hPct: d.watermark.textSizePct / 100,
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
