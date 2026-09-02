#!/usr/bin/env node
// Rebuilds vendor/fonts/fonts.css (woff2 → base64 data-URIs, subsets latin/latin-ext/vietnamese)
// and vendor/fonts/ttf/<Family>-<weight>.ttf (whole-font static TTFs for libass image-mode).
//
// fonts.css is inlined into every scene page (see src/animation/harness.js fontsCss()),
// so a hard byte budget guards render performance: over budget → exit 1, nothing written.
// Writes are atomic (tmp + rename) and the previous fonts.css is kept as fonts.css.bak.
//
// Usage: npm run fonts:build      (scene fonts — network required)
//        npm run fonts:build:ui   (UI fonts only: public/fonts/*.woff2 + public/css/fonts.css;
//                                  never touches vendor/fonts/fonts.css)
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_DIR = join(ROOT, 'vendor', 'fonts');
const TTF_DIR = join(FONTS_DIR, 'ttf');
const OUT_CSS = join(FONTS_DIR, 'fonts.css');
const UI_FONTS_DIR = join(ROOT, 'public', 'fonts');
const UI_OUT_CSS = join(ROOT, 'public', 'css', 'fonts.css');
const BUDGET = Math.round(1.3 * 1024 * 1024);

// Google serves per-subset woff2 to a modern-Chrome UA, and whole-font TTF to legacy UAs.
const UA_WOFF2 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_TTF = 'curl/8.4.0';

const MANIFEST = [
  { family: 'Be Vietnam Pro', weights: [500, 700, 800], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'JetBrains Mono', weights: [500, 700], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'Montserrat', weights: [800], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'Oswald', weights: [700], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'Anton', weights: [400], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'Nunito', weights: [900], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'Archivo Black', weights: [400], subsets: ['latin', 'latin-ext', 'vietnamese'] },
  { family: 'Lexend', weights: [700], subsets: ['latin', 'latin-ext', 'vietnamese'] },
];

// UI shell fonts (served as static files — small, cache-immutable; NOT inlined into scene pages).
// The app's own interface is being translated into every language the table lists, so the shell
// font needs their glyphs. CJK is deliberately absent: one Noto Sans SC face is 5-20 MB, and the
// OS UI font already in the CSS fallback (-apple-system / Segoe UI) draws it correctly — for the
// app chrome that trade is worth taking, for the video it is not (see styleguide/script-fonts.js).
const UI_SUBSETS = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'greek', 'thai', 'devanagari'];
const UI_MANIFEST = [
  { family: 'Lexend', weights: [400, 500, 600, 700, 800], subsets: UI_SUBSETS },
  { family: 'JetBrains Mono', weights: [500], subsets: ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'greek'] },
];

function cssUrl(family, weights) {
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weights.join(';')}&display=swap`;
}

async function fetchText(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const dlCache = new Map(); // url → base64 (weights of one family can share a woff2 file)
async function fetchB64(url) {
  if (!dlCache.has(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    dlCache.set(url, Buffer.from(await res.arrayBuffer()).toString('base64'));
  }
  return dlCache.get(url);
}

// css2 woff2 responses annotate each @font-face with a `/* subset */` comment.
function parseSubsetBlocks(css) {
  const out = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
  let m;
  while ((m = re.exec(css))) out.push({ subset: m[1], block: m[2] });
  return out;
}

async function buildFamilyCss(entry) {
  const css = await fetchText(cssUrl(entry.family, entry.weights), UA_WOFF2);
  const blocks = parseSubsetBlocks(css).filter((b) => entry.subsets.includes(b.subset));
  if (!blocks.length) throw new Error(`${entry.family}: no @font-face blocks for wanted subsets`);
  const got = new Set(blocks.map((b) => b.subset));
  for (const s of entry.subsets) {
    if (!got.has(s)) console.warn(`  ⚠ ${entry.family}: subset '${s}' not offered by Google Fonts`);
  }
  let out = '';
  for (const b of blocks) {
    const um = /url\((https:[^)]+)\)/.exec(b.block);
    if (!um) throw new Error(`${entry.family}: @font-face without src url`);
    const b64 = await fetchB64(um[1]);
    out += `/* ${b.subset} */\n${b.block.replace(um[1], `data:font/woff2;base64,${b64}`)}\n`;
  }
  // font-display: block — never paint fallback glyphs in a deterministic renderer; the
  // harness force-loads every face before the timeline builds, so swap's "show fallback
  // first" behavior could only ever produce a mid-video font flash.
  out = out.replace(/font-display:\s*swap/g, 'font-display: block');
  return { css: out, faces: blocks.length };
}

async function downloadFamilyTtfs(entry) {
  const css = await fetchText(cssUrl(entry.family, entry.weights), UA_TTF);
  if (!/format\('truetype'\)/.test(css)) throw new Error('response is not TTF (UA trick blocked?)');
  const files = [];
  const seen = new Set();
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
    const wm = /font-weight:\s*(\d+)/.exec(block);
    const um = /url\((https:[^)]+)\)/.exec(block);
    if (!wm || !um || seen.has(wm[1])) continue;
    seen.add(wm[1]);
    const name = `${entry.family.replace(/ /g, '')}-${wm[1]}.ttf`;
    const res = await fetch(um[1]);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${um[1]}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = join(TTF_DIR, `.${name}.tmp`);
    writeFileSync(tmp, buf);
    renameSync(tmp, join(TTF_DIR, name));
    files.push({ name, bytes: buf.length });
  }
  if (!files.length) throw new Error('no TTF urls parsed');
  return files;
}

function fmtKB(n) { return `${(n / 1024).toFixed(1)} KB`; }

// ---- UI fonts: woff2 saved as real files + public/css/fonts.css with url() sources ----
// Filenames encode family-weight-subset, so /fonts can be served cache-immutable:
// any manifest change produces new URLs.
async function buildUiFonts() {
  mkdirSync(UI_FONTS_DIR, { recursive: true });
  let cssOut = '/* Generated by scripts/build-fonts.mjs --ui — do not edit by hand. */\n';
  let totalBytes = 0;
  const urlToName = new Map(); // variable fonts: all weights share one woff2 URL — store it once
  for (const entry of UI_MANIFEST) {
    const css = await fetchText(cssUrl(entry.family, entry.weights), UA_WOFF2);
    const blocks = parseSubsetBlocks(css).filter((b) => entry.subsets.includes(b.subset));
    if (!blocks.length) throw new Error(`${entry.family}: no @font-face blocks for wanted subsets`);
    for (const b of blocks) {
      const um = /url\((https:[^)]+)\)/.exec(b.block);
      const wm = /font-weight:\s*(\d+)/.exec(b.block);
      if (!um || !wm) throw new Error(`${entry.family}: @font-face without src url/weight`);
      if (!urlToName.has(um[1])) {
        const name = `${entry.family.replace(/ /g, '')}-${wm[1]}-${b.subset}.woff2`;
        const res = await fetch(um[1]);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${um[1]}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmp = join(UI_FONTS_DIR, `.${name}.tmp`);
        writeFileSync(tmp, buf);
        renameSync(tmp, join(UI_FONTS_DIR, name));
        totalBytes += buf.length;
        urlToName.set(um[1], name);
      }
      cssOut += `/* ${b.subset} */\n${b.block.replace(um[1], `/fonts/${urlToName.get(um[1])}`)}\n`;
    }
    console.log(`✓ ui ${entry.family} [${entry.weights.join(',')}]`);
  }
  const tmp = `${UI_OUT_CSS}.tmp`;
  writeFileSync(tmp, cssOut);
  renameSync(tmp, UI_OUT_CSS);
  console.log(`✓ wrote ${UI_OUT_CSS} (${fmtKB(Buffer.byteLength(cssOut))} css, ${urlToName.size} woff2 files, ${fmtKB(totalBytes)})`);
}

async function main() {
  if (process.argv.includes('--ui')) return buildUiFonts(); // UI-only path: vendor/fonts untouched
  // ---- 1. woff2 → fonts.css (all-or-nothing, budget-guarded) ----
  const rows = [];
  let cssOut = '/* Generated by scripts/build-fonts.mjs — do not edit by hand. */\n';
  for (const entry of MANIFEST) {
    const { css, faces } = await buildFamilyCss(entry);
    cssOut += css;
    rows.push({ family: entry.family, weights: entry.weights.join(','), faces, bytes: Buffer.byteLength(css) });
  }
  const total = Buffer.byteLength(cssOut);

  console.log('\nFamily              Weights      Faces   CSS cost');
  console.log('-'.repeat(52));
  for (const r of rows) {
    console.log(`${r.family.padEnd(20)}${r.weights.padEnd(13)}${String(r.faces).padEnd(8)}${fmtKB(r.bytes)}`);
  }
  console.log('-'.repeat(52));
  console.log(`TOTAL fonts.css: ${fmtKB(total)} (budget ${fmtKB(BUDGET)})`);

  if (total > BUDGET) {
    console.error(`\n✗ Over budget by ${fmtKB(total - BUDGET)} — nothing written. Trim MANIFEST weights/families.`);
    process.exit(1);
  }

  if (existsSync(OUT_CSS)) copyFileSync(OUT_CSS, `${OUT_CSS}.bak`);
  const tmp = `${OUT_CSS}.tmp`;
  writeFileSync(tmp, cssOut);
  renameSync(tmp, OUT_CSS);
  console.log(`✓ wrote ${OUT_CSS}`);

  // ---- 2. TTFs for libass (optional per family — image-mode fallback fonts) ----
  mkdirSync(TTF_DIR, { recursive: true });
  const ttfFailures = [];
  for (const entry of MANIFEST) {
    try {
      const files = await downloadFamilyTtfs(entry);
      console.log(`✓ ttf ${entry.family}: ${files.map((f) => `${f.name} (${fmtKB(f.bytes)})`).join(', ')}`);
    } catch (e) {
      ttfFailures.push(entry.family);
      console.warn(`⚠ ttf ${entry.family}: ${e.message} — skipped (optional)`);
    }
  }
  if (ttfFailures.length) console.warn(`\nTTF missing for: ${ttfFailures.join(', ')} (fonts.css unaffected)`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
