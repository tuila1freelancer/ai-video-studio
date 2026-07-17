// Final-video logo overlay geometry (P26). ONE formula owns the logo's placement: the
// Brand Kit preview positions its ghost with these exact fractions (CSS percentages +
// translate(-50%,-50%)) and ffmpeg receives the integers computed here — WYSIWYG by
// construction, not by calibration. Center + width-fraction storage keeps the config
// resolution-independent (the same brandKit renders identically at 1080p or 4K).

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Normalize a stored finalOverlay block → safe fractions (or null when disabled). */
export function resolveFinalOverlay(fo) {
  if (!fo || fo.enabled !== true) return null;
  return {
    cxPct: clamp(fo.cxPct, 0, 1, 0.92),
    cyPct: clamp(fo.cyPct, 0, 1, 0.08),
    wPct: clamp(fo.wPct, 0.02, 0.45, 0.085),
    opacity: clamp(fo.opacity, 0.2, 1, 0.9),
  };
}

/**
 * The single source of truth mapping fractions → output pixels.
 * @param {{cxPct:number,cyPct:number,wPct:number}} fo center + width fractions
 * @param {{W:number,H:number,logoW:number,logoH:number}} dims frame + intrinsic logo size
 * @returns {{lw:number,lh:number,x:number,y:number}} scaled size + top-left corner
 */
export function logoRect({ cxPct, cyPct, wPct }, { W, H, logoW, logoH }) {
  const lw = Math.round(wPct * W);
  const lh = Math.round(lw * (logoH / logoW));
  return { lw, lh, x: Math.round(cxPct * W - lw / 2), y: Math.round(cyPct * H - lh / 2) };
}
