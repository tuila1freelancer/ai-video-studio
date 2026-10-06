// Every @font-face the scene page can carry: the vendored set, the user's uploads and the
// families fetched on request — and which of them a page actually references.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_DIR } from '../../config/paths.js';

import { downloadedCss, downloadedFamilies, downloadedStamp } from '../../fonts/files.js';

let fontsCssCache = null;
let faceBlocksCache = null;

function parseFaces(css) {
  const out = [];
  for (const m of String(css || '').matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const fam = /font-family:\s*['"]([^'"]+)['"]/.exec(m[0])?.[1];
    if (fam) out.push({ family: fam, block: m[0] });
  }
  return out;
}

// Downloaded families are re-read rather than cached for the process lifetime: the user can
// fetch one from the Library while the app is running, and the very next preview has to see it.
let webCache = { stamp: '', blocks: [] };
function webFaces() {
  const stamp = downloadedStamp();
  if (stamp !== webCache.stamp) {
    webCache = { stamp, blocks: downloadedFamilies().flatMap((f) => parseFaces(downloadedCss(f))) };
  }
  return webCache.blocks;
}

/** Every `@font-face` the renderer can supply — vendored plus anything fetched on request. */
function faceBlocks() {
  if (!faceBlocksCache) faceBlocksCache = parseFaces(rawFontsCss());
  return [...faceBlocksCache, ...webFaces()];
}

function rawFontsCss() {
  if (fontsCssCache == null) {
    const p = join(VENDOR_DIR, 'fonts', 'fonts.css');
    fontsCssCache = existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return fontsCssCache;
}

/** Families the vendored CSS can supply — the scan set for `familiesIn`. */
export function vendoredFamilies() {
  return [...new Set(faceBlocks().map((f) => f.family))];
}

/**
 * Which of `known` does this page actually name?
 *
 * A plain substring scan rather than a CSS parse, on purpose: families are referenced from
 * `font-family:` declarations, from `font:` shorthand (`.wmt`), from inline style attributes, and
 * from whatever the codegen model wrote into the scene's own CSS. Missing one would silently
 * substitute a typeface; including one spuriously costs a few KB. The asymmetry decides it.
 */
export function familiesIn(text, known) {
  const s = String(text || '');
  return (known || []).filter((f) => s.includes(f));
}

/**
 * The `@font-face` blocks for `families`, or the whole vendored sheet when asked for everything.
 *
 * Every scene page used to carry all eight vendored families — 516 KB of base64 on a 757 KB page,
 * repeated for all 95 scenes of a video, to render text that names one or two of them. Embedding
 * only what the page references takes ~500 KB off each one, and it is the change that lets the
 * catalogue grow past a handful of Latin faces at all: a single CJK face is larger than the
 * entire current sheet.
 */
export function fontsCss(families) {
  if (!families) return rawFontsCss();
  const want = new Set(families);
  return faceBlocks().filter((f) => want.has(f.family)).map((f) => f.block).join('\n');
}

/**
 * Scene hand-off — emitted as its OWN script, only for a clip that asked for it.
 *
 * The clip's CONTENT leaves before the cut and arrives just after it, while the ground — the stage
 * gradient, the background canvas, the vignette, the grain, the progress bar and the watermark —
 * never moves. That asymmetry is the whole point: consecutive scenes share a backdrop, so a
 * cross-dissolve between them was only ever dissolving text over text, and a longer one made the
 * collision worse rather than softer. Ramping `.hf-cam` (the motif and the scene body, and nothing
 * else) leaves the join blending an emptied frame against an arriving one, over a ground that is
 * continuous through the cut. That is the "smooth and natural" the concat alone cannot buy.
 *
 * It is a separate script, registered through the public `window.__onSeek`, rather than a branch
 * inside RUNTIME — RUNTIME is one constant string, so a branch in it would change the bytes of
 * EVERY scene page including those of projects that never asked (tests/scene-page-golden.test.js).
 * This way an untouched project's page is identical to the byte and its clips stay valid.
 *
 * It runs on REAL time, like the caption and the progress bar. The template layers live in warped
 * authored coordinates and a hand-off that drifted with the warp would not meet a cut that happens
 * at a real timestamp. The window fits inside the clip's own silence (measured 0.68–0.93s of
 * trailing breath pad, 0.19–0.20s leading), so no narration is touched.
 */
