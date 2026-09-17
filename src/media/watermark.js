// Copyright watermark (P28): the logo or channel name drifts slowly around the frame
// perimeter to stamp ownership. ONE piecewise path (perimeterPos) is the single source of
// truth — the Brand Kit preview animates a ghost with it (JS/rAF) and the final concat
// receives the SAME path as ffmpeg overlay/drawtext expressions built by perimeterExpr.
// Pure t-based math: deterministic, resolution-independent, no wall clock.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_DIR } from '../config/paths.js';
import { clampNum } from '../util/util.js';

export const WM_SPEEDS = { slower: 120, slow: 75, medium: 45 }; // seconds per full lap


/** Normalize a stored brandKit.watermark block → safe config (null when off). */
export function resolveWatermark(wm) {
  if (!wm || wm.enabled !== true) return null;
  return {
    source: wm.source === 'name' ? 'name' : 'logo',
    speed: WM_SPEEDS[wm.speed] ? wm.speed : 'slow',
    opacity: clampNum(wm.opacity, 0.1, 0.8, 0.35),
    wPct: clampNum(wm.wPct, 0.03, 0.2, 0.06),   // logo width as a fraction of frame width
    hPct: clampNum(wm.hPct, 0.018, 0.06, 0.028), // text height as a fraction of frame height
    marginPct: 0.02, // edge gap as a fraction of min(W,H)
  };
}

/**
 * Perimeter path — clockwise from the top-left corner, constant speed per edge quarter.
 * @param {number} u lap phase [0,1)
 * @param {{bw:number,bh:number,mx:number,my:number}} box+margin as FRACTIONS of the frame
 * @returns {{x:number,y:number}} TOP-LEFT corner of the box, as fractions
 */
export function perimeterPos(u, { bw, bh, mx, my }) {
  const x0 = mx, x1 = Math.max(mx, 1 - mx - bw), y0 = my, y1 = Math.max(my, 1 - my - bh);
  const px = x1 - x0, py = y1 - y0;
  const t = ((u % 1) + 1) % 1;
  if (t < 0.25) return { x: x0 + px * (t / 0.25), y: y0 };
  if (t < 0.5) return { x: x1, y: y0 + py * ((t - 0.25) / 0.25) };
  if (t < 0.75) return { x: x1 - px * ((t - 0.5) / 0.25), y: y1 };
  return { x: x0, y: y1 - py * ((t - 0.75) / 0.25) };
}

/**
 * The SAME path as ffmpeg x/y expressions (evaluated per frame from `t`).
 * Variable names differ per filter: overlay uses W/H/w/h, drawtext uses w/h/tw/th.
 */
export function perimeterExpr({ varW = 'W', varH = 'H', varw = 'w', varh = 'h', period = 75, marginPx = 24 }) {
  const m = Math.round(marginPx);
  const X0 = `${m}`, X1 = `(${varW}-${varw}-${m})`;
  const Y0 = `${m}`, Y1 = `(${varH}-${varh}-${m})`;
  const PX = `(${varW}-${varw}-${2 * m})`, PY = `(${varH}-${varh}-${2 * m})`;
  const u = `(mod(t,${period})/${period})`;
  const x = `if(lt(${u},0.25),${X0}+${PX}*(${u}/0.25),`
    + `if(lt(${u},0.5),${X1},`
    + `if(lt(${u},0.75),${X1}-${PX}*((${u}-0.5)/0.25),${X0})))`;
  const y = `if(lt(${u},0.25),${Y0},`
    + `if(lt(${u},0.5),${Y0}+${PY}*((${u}-0.25)/0.25),`
    + `if(lt(${u},0.75),${Y1},${Y1}-${PY}*((${u}-0.75)/0.25))))`;
  return { x, y };
}

/** Vietnamese-safe vendored TTF for the drawtext lane (null when the vendor set is absent). */
export function watermarkFont() {
  const dir = join(VENDOR_DIR, 'fonts', 'ttf');
  try {
    const files = readdirSync(dir).filter((f) => /\.ttf$/i.test(f));
    const pick = files.find((f) => /BeVietnamPro-700/i.test(f))
      || files.find((f) => /BeVietnamPro/i.test(f))
      || files.find((f) => /Lexend|Montserrat/i.test(f))
      || files[0];
    return pick && existsSync(join(dir, pick)) ? join(dir, pick) : null;
  } catch { return null; }
}
