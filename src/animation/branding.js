// Brand Kit — per-channel branding composited into every scene: the channel-name badge and
// optional stickers, both at USER-FIXED positions. The logo itself never rides the scene
// pages anymore: it burns once at final concat (the P26 WYSIWYG stamp) — the old 'smart'
// auto-avoid placement was removed by owner order (2026-07-17, "không thực tế").
//
// Determinism contract: the layer is 100% static DOM/CSS (no animations, no randomness at
// render time — sticker cadence is a pure function of scene index). When brandKit is absent
// buildSceneHtml passes brand:null and page output stays byte-identical to the legacy path.
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

export function imgDataUri(path) {
  if (!path || !existsSync(path)) return null;
  const ext = (extname(path).slice(1) || 'png').toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'svg' ? 'image/svg+xml' : 'image/png';
  try { return `data:${mime};base64,${readFileSync(path).toString('base64')}`; } catch { return null; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// Sticker corner anchors (page corners, outside the centered content column).
const CORNER_POS = {
  tl: { xPct: 0.075, yPct: 0.06 },
  tr: { xPct: 0.925, yPct: 0.06 },
  bl: { xPct: 0.075, yPct: 0.9 },
  br: { xPct: 0.925, yPct: 0.9 },
};

// Normalize channel.config.brandKit → safe internal shape, or null when branding is off/absent.
// The logo is deliberately NOT part of this layer (stamp-only, P26); `channelName` is still
// exposed for the planner (hook labels / outro CTA). Legacy `placement:'off'` keeps meaning
// "no per-scene brand chrome at all".
export function resolveBrandKit(config) {
  const bk = config?.brandKit;
  if (!bk || typeof bk !== 'object' || bk.placement === 'off') return null; // legacy global off
  const channelName = String(bk.channelName || '').trim();
  const nameBadge = (bk.nameBadge?.enabled !== false && channelName) ? {
    text: String(bk.nameBadge?.text || channelName).trim(),
    position: { xPct: clamp(bk.nameBadge?.position?.xPct, 0, 1, 0.5), yPct: clamp(bk.nameBadge?.position?.yPct, 0, 1, 0.045) },
    style: ['pill', 'underline'].includes(bk.nameBadge?.style) ? bk.nameBadge.style : 'plain',
  } : null;
  const stickers = Array.isArray(bk.stickers)
    ? bk.stickers.filter((s) => s?.assetPath && existsSync(s.assetPath)).slice(0, 8)
    : [];
  if (!channelName && !stickers.length) return null;
  return { channelName, nameBadge, stickers };
}

// Where each brand element goes on THIS scene — always the user-fixed positions now.
// Pure function of its inputs → deterministic.
export function planBrandPlacement(brand, { templateId, idx = 0, total = 9999, captionsOn = true } = {}) {
  if (!brand) return null;
  const out = { badge: null, sticker: null };
  if (brand.nameBadge) out.badge = brand.nameBadge.position;
  // Sticker cadence: chapter/outro scenes always get one; otherwise every 6th scene.
  if (brand.stickers.length) {
    const isBeat = templateId === 'chapter-break' || templateId === 'cta-outro' || idx === total - 1;
    if (isBeat || idx % 6 === 3) {
      const st = brand.stickers[idx % brand.stickers.length];
      const corner = captionsOn ? 'tl' : 'bl';
      out.sticker = { ...st, position: { xPct: CORNER_POS[corner].xPct, yPct: captionsOn ? 0.2 : CORNER_POS[corner].yPct } };
    }
  }
  return (out.badge || out.sticker) ? out : null;
}

// Build the static overlay layer. All sizes precomputed in px from the scene dimensions.
export function buildBrandLayer(brand, placement, { w, h, theme }) {
  if (!brand || !placement) return null;
  const m = Math.min(w, h);
  const u = (n) => Math.round(m * n / 100);
  const parts = [];
  let css = `
  .brandlyr{position:absolute;inset:0;z-index:40;pointer-events:none}
  .bl-el{position:absolute;transform:translate(-50%,-50%)}`;

  if (brand.nameBadge && placement.badge) {
    const fs = u(1.9);
    const base = `left:${(placement.badge.xPct * 100).toFixed(2)}%;top:${(placement.badge.yPct * 100).toFixed(2)}%;font:700 ${fs}px ${theme.mono};letter-spacing:.16em;text-transform:uppercase;white-space:nowrap`;
    const styleCss = brand.nameBadge.style === 'pill'
      ? `${base};color:${theme.bg};background:${theme.accents[0]};padding:${u(0.6)}px ${u(1.6)}px;border-radius:${u(2)}px;box-shadow:${theme.glowSoft(theme.accents[0])}`
      : brand.nameBadge.style === 'underline'
        ? `${base};color:${theme.ink};padding-bottom:${u(0.5)}px;border-bottom:${Math.max(2, u(0.2))}px solid ${theme.accents[0]};text-shadow:0 1px 8px rgba(0,0,0,.6)`
        : `${base};color:${theme.muted};text-shadow:0 1px 8px rgba(0,0,0,.6)`;
    css += `
  .bl-badge{${styleCss}}`;
    parts.push(`<div class="bl-el bl-badge">${esc(brand.nameBadge.text)}</div>`);
  }
  if (placement.sticker) {
    const sw = u(14);
    const uri = imgDataUri(placement.sticker.assetPath);
    if (uri) {
      css += `
  .bl-sticker{left:${(placement.sticker.position.xPct * 100).toFixed(2)}%;top:${(placement.sticker.position.yPct * 100).toFixed(2)}%;width:${sw}px;opacity:.95;filter:drop-shadow(0 ${u(0.3)}px ${u(1)}px rgba(0,0,0,.45))}
  .bl-sticker img{width:100%;height:auto;display:block}`;
      parts.push(`<div class="bl-el bl-sticker"><img src="${uri}"></div>`);
    }
  }
  if (!parts.length) return null;
  return { css, html: `<div class="brandlyr">${parts.join('')}</div>` };
}
