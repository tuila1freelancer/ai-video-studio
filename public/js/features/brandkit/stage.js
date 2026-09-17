// The WYSIWYG stage: geometry mirrored from the render (P26/P28), corner presets, the watermark drift preview, drag and snap.
import { $, $$ } from '../../ui/dom.js';
import { fileUrl } from '../../api.js';
import { state } from '../../state.js';
import { resRung } from '../../views/config.js';
import { m, tp } from '../../i18n.js';
import { RATIO_SIZE, SNAPS, CORNER_GAP, WM_MARGIN, WM_PERIODS, WM_PREVIEW_SPEED } from './draft.js';

export const arValue = () => $('#cfgAr')?.value || '9:16';
// The stamp is stored as fractions, so the ghost sits in the right place at any resolution — but
// the px readout under the stage claims to be "the integers ffmpeg receives", and at 4K it was
// quoting half of them. Follow the resolution the project will actually encode at.
const resScale = () => resRung($('#cfgRes')?.value);
export const frameWH = () => {
  const [w, h] = RATIO_SIZE[arValue()] || RATIO_SIZE['9:16'];
  const k = resScale();
  return [w * k, h * k];
};

let wmRaf = 0; // watermark preview animation handle

export function applyControlState() {
  const d = state.brandDraft; if (!d) return;
  $('#stampOpts').style.display = d.stamp.enabled ? '' : 'none';
  $('#wmOpts').classList.toggle('hidden', !d.watermark.enabled);
  $('#brandLogoSize').value = d.stamp.wPct * 100;
  $('#brandLogoOpacity').value = Math.round(d.stamp.opacity * 100);
  const s = $('#wmSize');
  if (d.watermark.source === 'logo') { s.min = 3; s.max = 20; s.step = 0.5; s.value = d.watermark.logoSizePct; }
  else { s.min = 1.8; s.max = 6; s.step = 0.2; s.value = d.watermark.textSizePct; }
}

export function syncBrandStage() {
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
    badgeEl.textContent = (d.channelName || m('TÊN KÊNH')).toUpperCase();
    badgeEl.style.left = (d.badge.position.xPct * 100) + '%';
    badgeEl.style.top = (d.badge.position.yPct * 100) + '%';
  } else badgeEl.classList.add('hidden');
  $('#brandLogoSizeL').textContent = tp`${(d.stamp.wPct * 100).toFixed(1)}% rộng khung`;
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
  if (!d?.logo?.assetPath) { el.textContent = m('Tải logo lên để đóng dấu.'); return; }
  const [W, H] = frameWH();
  const img = $('#bstLogoImg');
  const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const lw = Math.round(d.stamp.wPct * W), lh = Math.round(lw * (ih / iw));
  const x = Math.round(d.stamp.position.xPct * W - lw / 2), y = Math.round(d.stamp.position.yPct * H - lh / 2);
  el.textContent = tp`Đóng dấu: x=${x}px · y=${y}px · logo ${lw}×${lh}px @ ${W}×${H}`;
}

// ---- corner presets: logo box edges sit CORNER_GAP·min(W,H) from the frame edges ----
export function cornerCenter(corner) {
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
export function startWmPreview() {
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
    // Stops with the modal; the next open starts it again. It used to run for the whole session.
    if ($('#brandModal').classList.contains('open')) wmRaf = requestAnimationFrame(tick);
  };
  wmRaf = requestAnimationFrame(tick);
}

const snapTo = (v) => { for (const s of SNAPS) if (Math.abs(v - s) < 0.012) return s; return null; };

// pointer-drag ghosts → xPct/yPct (center-based, clamped); the stamp gets snap guides
export function wireBrandDrag(el, getPos, { snap } = {}) {
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

export function setStampSize(valuePct) {
  const d = state.brandDraft; if (!d) return;
  d.stamp.wPct = Math.min(0.4, Math.max(0.02, valuePct / 100));
  syncBrandStage();
}
