// Final-video logo overlay geometry (P26). ONE formula owns the logo's placement: the
// Brand Kit preview positions its ghost with these exact fractions (CSS percentages +
// translate(-50%,-50%)) and ffmpeg receives the integers computed here — WYSIWYG by
// construction, not by calibration. Center + width-fraction storage keeps the config
// resolution-independent (the same brandKit renders identically at 1080p or 4K).
import { clampNum } from '../util/util.js';


/** Normalize a stored finalOverlay block → safe fractions (or null when disabled). */
export function resolveFinalOverlay(fo) {
  if (!fo || fo.enabled !== true) return null;
  return {
    cxPct: clampNum(fo.cxPct, 0, 1, 0.92),
    cyPct: clampNum(fo.cyPct, 0, 1, 0.08),
    wPct: clampNum(fo.wPct, 0.02, 0.45, 0.085),
    opacity: clampNum(fo.opacity, 0.2, 1, 0.9),
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

/**
 * Should this concat stamp a logo, and where?
 *
 * The version of this that lived inline in finalize only ever ASSIGNED a logo (`if (bkLogo &&
 * !config.logo?.path)`) — it had no way to say "no". Turning the stamp off in the Brand Kit
 * therefore did nothing to a project that had already resolved one, which is the behaviour the
 * owner reported: the toggle moves, the logo stays. The decision has to be re-made from scratch
 * on every concat, and "off" has to be one of the answers.
 *
 * Precedence, most specific first:
 *   1. `config.logo === null`            → the owner turned it off for THIS video
 *   2. `config.logo.enabled === false`   → same, spelled as a flag
 *   3. `config.logo.path`                → a per-project override, used as given
 *   4. brand kit `finalOverlay.enabled`  → the normal channel stamp
 *   5. legacy per-scene placement        → migrated so nobody's logo silently disappears
 *   6. otherwise                         → no logo
 *
 * @param {object} config resolved project config (its brandKit already merged with the channel)
 * @param {{w:number,h:number}} size output frame — only the legacy branch needs it
 * @returns {{path:string,cxPct:number,cyPct:number,wPct:number,opacity:number}|null}
 */
export function resolveConcatLogo(config, size = { w: 1920, h: 1080 }) {
  const own = config?.logo;
  if (own === null) return null;
  if (own && own.enabled === false) return null;
  if (own && own.path) {
    // an override may still be stored in the legacy {size, position} shape; leave that to the
    // concat's own legacy branch by passing it through untouched
    if (!Number.isFinite(+own.wPct)) return { ...own };
    return { ...own, ...resolveFinalOverlay({ enabled: true, ...own }) };
  }

  const bk = config?.brandKit;
  const bkLogo = bk?.logo?.assetPath;
  if (!bkLogo) return null;

  const fov = resolveFinalOverlay(bk.finalOverlay);
  if (fov) return { path: bkLogo, ...fov };
  // An explicit `finalOverlay: {enabled: false}` means OFF — never fall through to the legacy
  // branch and resurrect the stamp the owner just switched off.
  if (bk.finalOverlay !== undefined) return null;

  // Configs saved before the whole-video stamp existed: per-scene placement + a logo, no
  // finalOverlay key at all. Map the old geometry (sizePct = % of the min dimension, centre
  // position) onto the stamp fractions so those videos keep their logo.
  if (bk.placement && bk.placement !== 'off') {
    const bl = bk.logo;
    const minD = Math.min(size.w, size.h);
    return {
      path: bkLogo,
      cxPct: bl.position?.xPct ?? 0.92,
      cyPct: bl.position?.yPct ?? 0.06,
      wPct: Math.min(0.45, Math.max(0.02, ((bl.sizePct || 8.5) / 100) * (minD / size.w))),
      opacity: bl.opacity ?? 0.9,
    };
  }
  return null;
}
