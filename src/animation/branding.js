// Brand Kit — per-channel branding composited into every scene: logo, channel-name badge,
// and optional stickers. Placement is either user-fixed ('always') or 'smart' (auto-snaps
// into a corner the current template leaves free, avoiding the caption band).
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

// Corners each template leaves free (page corners, outside the centered content column).
// Captions occupy the bottom band (~18%) — bottom corners are dropped when captions are on.
const CORNERS_DEFAULT = ['tr', 'tl', 'br', 'bl'];
export const TEMPLATE_SAFE_ZONES = {
  'kinetic-statement': ['tr', 'br'],   // left-aligned text column
  'list-reveal': ['tr', 'br'],
  'dual-keyword': ['tr', 'bl'],        // decorative icons sit tl/br
  'terminal-scan': ['tl', 'br'],       // warning tag leans top-right
  'chat-demo': ['tr', 'tl'],
  'bar-race': ['tr', 'tl'],            // value labels reach the right edge
};
const CORNER_POS = {
  tl: { xPct: 0.075, yPct: 0.06 },
  tr: { xPct: 0.925, yPct: 0.06 },
  bl: { xPct: 0.075, yPct: 0.9 },
  br: { xPct: 0.925, yPct: 0.9 },
};

// Normalize channel.config.brandKit → safe internal shape, or null when branding is off/absent.
export function resolveBrandKit(config) {
  const bk = config?.brandKit;
  if (!bk || typeof bk !== 'object' || bk.placement === 'off') return null;
  const logoPath = bk.logo?.assetPath && existsSync(bk.logo.assetPath) ? bk.logo.assetPath : null;
  const channelName = String(bk.channelName || '').trim();
  if (!logoPath && !channelName) return null;
  return {
    channelName,
    placement: bk.placement === 'always' ? 'always' : 'smart',
    logo: logoPath ? {
      assetPath: logoPath,
      position: { xPct: clamp(bk.logo?.position?.xPct, 0, 1, 0.925), yPct: clamp(bk.logo?.position?.yPct, 0, 1, 0.06) },
      sizePct: clamp(bk.logo?.sizePct, 3, 30, 8.5),
      opacity: clamp(bk.logo?.opacity, 0.1, 1, 0.9),
      style: ['glass', 'glow'].includes(bk.logo?.style) ? bk.logo.style : 'plain',
    } : null,
    nameBadge: (bk.nameBadge?.enabled !== false && channelName) ? {
      text: String(bk.nameBadge?.text || channelName).trim(),
      position: { xPct: clamp(bk.nameBadge?.position?.xPct, 0, 1, 0.5), yPct: clamp(bk.nameBadge?.position?.yPct, 0, 1, 0.045) },
      style: ['pill', 'underline'].includes(bk.nameBadge?.style) ? bk.nameBadge.style : 'plain',
    } : null,
    stickers: Array.isArray(bk.stickers)
      ? bk.stickers.filter((s) => s?.assetPath && existsSync(s.assetPath)).slice(0, 8)
      : [],
  };
}

// Where each brand element goes on THIS scene. Pure function of its inputs → deterministic.
export function planBrandPlacement(brand, { templateId, idx = 0, total = 9999, captionsOn = true } = {}) {
  if (!brand) return null;
  const out = { logo: null, badge: null, sticker: null };
  if (brand.placement === 'always') {
    if (brand.logo) out.logo = brand.logo.position;
    if (brand.nameBadge) out.badge = brand.nameBadge.position;
  } else {
    let free = (TEMPLATE_SAFE_ZONES[templateId] || CORNERS_DEFAULT).slice();
    if (captionsOn) free = free.filter((c) => c[0] !== 'b');
    if (!free.length) free = ['tr'];
    if (brand.logo) out.logo = CORNER_POS[free[0]];
    if (brand.nameBadge) {
      const c = free.find((x) => x !== free[0]) || free[0];
      out.badge = c === free[0]
        ? { xPct: CORNER_POS[c].xPct, yPct: CORNER_POS[c].yPct + 0.075 } // stack under the logo
        : CORNER_POS[c];
    }
  }
  // Sticker cadence: chapter/outro scenes always get one; otherwise every 6th scene.
  if (brand.stickers.length) {
    const isBeat = templateId === 'chapter-break' || templateId === 'cta-outro' || idx === total - 1;
    if (isBeat || idx % 6 === 3) {
      const st = brand.stickers[idx % brand.stickers.length];
      const corner = captionsOn ? (out.logo === CORNER_POS.tl ? 'tr' : 'tl') : 'bl';
      out.sticker = { ...st, position: { xPct: CORNER_POS[corner].xPct, yPct: captionsOn ? 0.2 : CORNER_POS[corner].yPct } };
    }
  }
  return (out.logo || out.badge || out.sticker) ? out : null;
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

  if (brand.logo && placement.logo) {
    const lw = u(brand.logo.sizePct);
    const uri = imgDataUri(brand.logo.assetPath);
    if (uri) {
      const styleCss = brand.logo.style === 'glass'
        ? `background:${theme.panel};border:1px solid ${theme.panelBorder};border-radius:${u(1.2)}px;padding:${u(0.8)}px;backdrop-filter:blur(6px)`
        : brand.logo.style === 'glow'
          ? `filter:drop-shadow(0 0 ${u(1.4)}px ${theme.accents[0]}88)`
          : '';
      css += `
  .bl-logo{left:${(placement.logo.xPct * 100).toFixed(2)}%;top:${(placement.logo.yPct * 100).toFixed(2)}%;width:${lw}px;opacity:${brand.logo.opacity};${styleCss}}
  .bl-logo img{width:100%;height:auto;display:block}`;
      parts.push(`<div class="bl-el bl-logo"><img src="${uri}"></div>`);
    }
  }
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
