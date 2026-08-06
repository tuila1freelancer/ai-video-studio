// Fetching a catalogue family on request, and keeping it where both renderers can see it.
//
// Two artefacts per family, because the two renderers cannot read each other's format:
//   <key>.css        base64 woff2 @font-face blocks — Chrome, for the scene pages and the preview
//   <Family>-<w>.ttf static faces — libass, for the burn
//
// A download is always something the owner asked for. It never happens during a render: a render
// that reaches out to the network is a render that can fail because a DNS server hiccupped, and
// the failure would land in the middle of a job the owner is paying for. If a family is missing
// at render time the answer is a loud error naming it, not an opportunistic fetch.
import { mkdirSync, writeFileSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from '../config/paths.js';
import { normFamily, webFontDir, downloadedCssPath } from './files.js';
import { catalogueEntry } from './registry.js';

// Google's css2 endpoint serves woff2 to a modern browser UA and TTF to an old one. Both are
// wanted: the browser lane needs woff2's size, libass needs a format it can rasterise.
const UA_WOFF2 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_TTF = 'curl/8.4.0';
const SUBSETS = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'greek', 'arabic', 'thai', 'devanagari', 'hebrew'];

function webDir() {
  mkdirSync(DIRS.fontWeb, { recursive: true });
  return DIRS.fontWeb;
}

export function removeFamily(family) {
  const key = normFamily(family);
  let removed = 0;
  for (const f of readdirSync(webDir())) {
    if (normFamily(f.replace(/\.(css|ttf)$/i, '').replace(/-\d{3}$/, '')) !== key) continue;
    try { rmSync(join(webDir(), f)); removed++; } catch { /* best effort */ }
  }
  return removed;
}

async function fetchText(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  if (!res.ok) throw new Error(`Google Fonts trả về HTTP ${res.status}`);
  return res.text();
}

const cssUrl = (family, weights) => `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weights.join(';')}&display=block`;

/**
 * Fetch one catalogue family and store both artefacts.
 *
 * @param {string} family must be in the catalogue — this is not a general downloader, and an
 *   arbitrary name from a request body has no business becoming a network fetch.
 * @returns {Promise<{family:string, faces:number, ttf:number, bytes:number}>}
 */
export async function downloadFamily(family) {
  const entry = catalogueEntry(family);
  if (!entry) throw new Error(`"${family}" không có trong danh mục font`);
  if (!entry.google) throw new Error(`"${family}" là font hệ thống — không cần tải`);

  const webCss = await fetchText(cssUrl(entry.google, entry.weights), UA_WOFF2);
  const blocks = [...webCss.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)]
    .filter((m) => SUBSETS.includes(m[1]));
  if (!blocks.length) throw new Error(`Google Fonts không trả về @font-face nào cho "${family}"`);

  let out = '';
  let bytes = 0;
  for (const [, subset, block] of blocks) {
    const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tải file font thất bại: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    bytes += buf.length;
    out += `/* ${subset} */\n${block.replace(url, `data:font/woff2;base64,${buf.toString('base64')}`)}\n`;
  }
  // font-display: block, never swap — the renderer force-loads every face before the timeline
  // builds, so "paint the fallback first" could only ever produce a mid-video font flash.
  out = out.replace(/font-display:\s*swap/g, 'font-display: block');

  // …and the same family as TTF, or the burn would have a font the preview does not.
  let ttf = 0;
  try {
    const ttfCss = await fetchText(cssUrl(entry.google, entry.weights), UA_TTF);
    const seen = new Set();
    for (const block of ttfCss.match(/@font-face\s*\{[^}]*\}/g) || []) {
      const w = /font-weight:\s*(\d+)/.exec(block)?.[1];
      const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
      if (!w || !url || seen.has(w)) continue;
      seen.add(w);
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const name = `${entry.family.replace(/ /g, '')}-${w}.ttf`;
      const tmp = join(webDir(), `.${name}.tmp`);
      writeFileSync(tmp, buf);
      renameSync(tmp, join(webDir(), name));
      ttf++;
      bytes += buf.length;
    }
  } catch { /* the web half is what the preview needs; a missing TTF surfaces at burn time */ }

  const dest = downloadedCssPath(entry.family);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, out, 'utf8');
  renameSync(tmp, dest);
  return { family: entry.family, faces: blocks.length, ttf, bytes };
}
