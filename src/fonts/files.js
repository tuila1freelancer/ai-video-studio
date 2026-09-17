// Which font file will libass actually use, and does it exist?
//
// fontconfig substitutes silently. Ask libass for a family it cannot find and it renders the
// subtitle in something else, writes nothing to stderr, and the video ships in the wrong
// typeface. There is no reliable way to detect that after the fact, so the check has to happen
// BEFORE the burn: resolve the family to a real file, put that one file in a directory of its
// own, and point `fontsdir` at it. One family, one file, no choices to get wrong.
//
// The browser side already has this discipline (harness `fontChecks` probes document.fonts and
// reports a miss); this is the same contract for the burn side.
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { VENDOR_DIR, DIRS } from '../config/paths.js';
import { userFontRows, familyOf } from '../animation/userfonts.js';

import { m, tp } from '../i18n/t.js';
/** Formats libass can rasterise. woff/woff2 are web-only — the browser reads them, libass cannot. */
const BURNABLE = new Set(['.ttf', '.otf', '.ttc']);

/** Compare family names the way humans type them: "Be Vietnam Pro" === "BeVietnamPro". */
export const normFamily = (f) => String(f || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/**
 * macOS families that ship with the OS. libass finds these through fontconfig without any
 * fontsdir, and they are the only practical answer for CJK / Arabic / Thai / Devanagari, where a
 * single face is 5–20 MB and vendoring one would dwarf the whole repo.
 */
export const SYSTEM_FAMILIES = new Set([
  'PingFang SC', 'PingFang TC', 'PingFang HK', 'Hiragino Sans', 'Hiragino Mincho ProN',
  'Apple SD Gothic Neo', 'Geeza Pro', 'Damascus', 'Thonburi', 'Kohinoor Devanagari',
  'Kohinoor Bangla', 'Kailasa', 'Mukta Mahee', 'Arial Unicode MS', 'Helvetica', 'Helvetica Neue',
  'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Menlo', 'Monaco',
  'Impact', 'Trebuchet MS', 'Avenir', 'Avenir Next', 'Futura', 'Optima', 'Palatino',
  'American Typewriter', 'Baskerville', 'Didot', 'Gill Sans', 'Charter', 'Noto Sans',
]);
const SYSTEM_NORM = new Set([...SYSTEM_FAMILIES].map(normFamily));

export function isSystemFamily(family) {
  return SYSTEM_NORM.has(normFamily(family));
}

/**
 * Static faces built alongside vendor/fonts/fonts.css by scripts/build-fonts.mjs, named
 * `<Family>-<weight>.ttf`. These are what the DOM lane draws with, so burning from the same
 * files is what keeps the two lanes looking alike.
 */
export function vendoredFaces() {
  const dir = join(VENDOR_DIR, 'fonts', 'ttf');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const ext = extname(name).toLowerCase();
    if (!BURNABLE.has(ext)) continue;
    const m = /^(.+?)-(\d{3})$/.exec(basename(name, ext));
    if (!m) continue;
    out.push({ family: m[1], key: normFamily(m[1]), weight: +m[2], path: join(dir, name), source: 'vendored' });
  }
  return out;
}

/** The owner's own uploads (Library → Fonts). The family name lives on the DB row, not the file. */
export function uploadedFaces() {
  const out = [];
  for (const row of userFontRows()) {
    const ext = extname(row.filename || row.path || '').toLowerCase();
    const family = familyOf(row);
    out.push({
      family, key: normFamily(family), weight: 400, path: row.path, source: 'uploaded',
      burnable: BURNABLE.has(ext), ext,
    });
  }
  return out;
}

// ---- families fetched from the catalogue on request (src/fonts/store.js writes them) ----

export function webFontDir() {
  mkdirSync(DIRS.fontWeb, { recursive: true });
  return DIRS.fontWeb;
}

export const downloadedCssPath = (family) => join(webFontDir(), `${normFamily(family)}.css`);

/** Stored `@font-face` CSS (base64 woff2) for a fetched family, or null. */
export function downloadedCss(family) {
  const p = downloadedCssPath(family);
  try { return existsSync(p) ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

export function isDownloaded(family) {
  return !!downloadedCss(family);
}

/** Changes whenever a fetched family is added, removed or rewritten — without reading any file. */
export function downloadedStamp() {
  try {
    const dir = webFontDir();
    return readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`).join('|');
  } catch { return ''; }
}

/** Display names of every fetched family, read back out of the CSS they were stored with. */
export function downloadedFamilies() {
  try {
    return readdirSync(webFontDir())
      .filter((f) => f.endsWith('.css'))
      .map((f) => /font-family:\s*['"]([^'"]+)['"]/.exec(readFileSync(join(webFontDir(), f), 'utf8'))?.[1])
      .filter(Boolean);
  } catch { return []; }
}

/** Static faces fetched alongside the CSS, in the same `<Family>-<weight>.ttf` shape as vendored. */
export function downloadedFaces() {
  try {
    return readdirSync(webFontDir())
      .filter((f) => f.toLowerCase().endsWith('.ttf'))
      .map((name) => {
        const m = /^(.+?)-(\d{3})\.ttf$/i.exec(name);
        return m ? { family: m[1], key: normFamily(m[1]), weight: +m[2], path: join(webFontDir(), name), source: 'downloaded' } : null;
      })
      .filter(Boolean);
  } catch { return []; }
}

export function allFaces() {
  return [...vendoredFaces(), ...downloadedFaces(), ...uploadedFaces()];
}

/**
 * Best file for a family at (or near) a weight.
 *
 * Weight is matched by distance rather than equality: the vendored set carries Be Vietnam Pro at
 * 500/700/800 and a preset asking for 800 must not fall back to "no font at all" just because a
 * different preset asked for 600.
 *
 * @returns {{path:string, family:string, weight:number, source:string, burnable?:boolean}|null}
 */
export function resolveFace(family, weight = 700) {
  const key = normFamily(family);
  if (!key) return null;
  const hits = allFaces().filter((f) => f.key === key);
  if (!hits.length) return null;
  // an upload beats a vendored face of the same name — the owner put it there on purpose
  const uploaded = hits.filter((f) => f.source === 'uploaded');
  const pool = uploaded.length ? uploaded : hits;
  return pool.slice().sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
}

/**
 * Stage the one font file this burn needs and hand back the directory to pass as `fontsdir`.
 *
 * Pointing fontsdir straight at vendor/fonts/ttf would work but leaves the weight up to
 * fontconfig — three Be Vietnam Pro faces sit in there. A directory holding exactly one file has
 * exactly one answer.
 *
 * @throws when the family cannot be satisfied. A loud failure is the point: a burned video in
 *   the wrong typeface is finished, paid-for work, not a warning worth logging.
 * @returns {{fontsDir:string|null, file:string|null, source:string}}
 */
export function prepareBurnFontDir(family, weight, workDir) {
  const face = resolveFace(family, weight);
  if (face && face.burnable === false) {
    throw new Error(
      tp`font "${family}" đang ở dạng ${face.ext} — libass chỉ đọc được .ttf/.otf. `
      + m('Hãy tải lên bản .ttf hoặc .otf trong Thư viện → Font chữ.'),
    );
  }
  if (face && existsSync(face.path)) {
    const dir = join(workDir, `assfont_${normFamily(family)}_${face.weight}`);
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `${normFamily(family)}${extname(face.path)}`);
    if (!existsSync(dest)) copyFileSync(face.path, dest);
    return { fontsDir: dir, file: dest, source: face.source };
  }
  if (isSystemFamily(family)) {
    // fontconfig resolves these on its own; a fontsdir would only get in the way
    return { fontsDir: null, file: null, source: 'system' };
  }
  throw new Error(
    tp`không tìm thấy font "${family}" để in lên video. `
    + m('Chọn font khác, hoặc tải file .ttf/.otf của nó lên trong Thư viện → Font chữ.'),
  );
}

/**
 * Scripts that need libass's complex-text shaper. Without it Arabic letters do not join and
 * Devanagari conjuncts come out as separate glyphs.
 */
export function shapingFor(language) {
  const lang = String(language || '').toLowerCase().slice(0, 2);
  return ['ar', 'fa', 'ur', 'he', 'hi', 'bn', 'ta', 'te', 'th', 'km', 'my'].includes(lang) ? 'complex' : null;
}
