// User-uploaded brand fonts (library kind 'font', files under DIRS.font). They join the
// vendored set at page-build time as an EXTRA @font-face block — vendor/fonts/fonts.css
// (repo asset, byte-budgeted) is never touched. Family name = the library item's name
// minus extension, so "MyBrand.ttf" becomes font-family 'MyBrand'.
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import * as DB from '../db/index.js';
import { VENDOR_DIR } from '../config/paths.js';

const FORMATS = { '.ttf': 'truetype', '.otf': 'opentype', '.woff2': 'woff2', '.woff': 'woff' };
const MAX_EMBED = 6 * 1024 * 1024; // an 8MB CJK font would bloat every scene page — skip, warn via families()

export function userFontRows() {
  try {
    return DB.listLibrary('font').filter((r) => r.path && existsSync(r.path) && FORMATS[extname(r.filename || r.path).toLowerCase()]);
  } catch { return []; }
}

export function familyOf(row) {
  return basename(row.name || row.filename, extname(row.name || row.filename)).replace(/[^\w \-]/g, '').trim() || 'CustomFont';
}

/** Family names the user has uploaded — the scan set a scene page filters against. */
export function uploadedFamilies() {
  return userFontRows().map(familyOf);
}

// cache keyed by the rows' identity+size fingerprint — uploads/deletes invalidate naturally
let cache = { stamp: '', css: '' };
/**
 * @param {string[]} [families] embed only these (a scene page names one or two); omit for all.
 *   An uploaded CJK face can be several MB, so "all" stopped being a sensible default once the
 *   library could hold more than a couple of brand fonts.
 */
export function userFontsCss(families) {
  const rows = families
    ? userFontRows().filter((r) => families.includes(familyOf(r)))
    : userFontRows();
  const stamp = `${families ? families.join(',') : '*'}|${rows.map((r) => `${r.id}:${r.size}`).join('|')}`;
  if (stamp === cache.stamp) return cache.css;
  const css = rows.map((r) => {
    try {
      if ((r.size || 0) > MAX_EMBED) return '';
      const ext = extname(r.filename || r.path).toLowerCase();
      const b64 = readFileSync(r.path).toString('base64');
      return `@font-face{font-family:'${familyOf(r)}';src:url(data:font/${ext.slice(1)};base64,${b64}) format('${FORMATS[ext]}');font-display:block}`;
    } catch { return ''; }
  }).filter(Boolean).join('\n');
  cache = { stamp, css };
  return css;
}

/** Every family the user can pick from: vendored (fonts.css) + uploaded. */
export function fontFamilies() {
  const vendored = [];
  try {
    const css = readFileSync(join(VENDOR_DIR, 'fonts', 'fonts.css'), 'utf8');
    for (const m of css.matchAll(/font-family:\s*'([^']+)'/g)) {
      if (!vendored.includes(m[1])) vendored.push(m[1]);
    }
  } catch { /* vendored css missing — dev checkout */ }
  const uploaded = userFontRows().map((r) => ({
    name: familyOf(r), tooBig: (r.size || 0) > MAX_EMBED,
  }));
  return {
    families: [
      ...vendored.map((name) => ({ name, source: 'vendored' })),
      ...uploaded.map((u) => ({ name: u.name, source: 'uploaded', ...(u.tooBig ? { tooBig: true } : {}) })),
    ],
  };
}
