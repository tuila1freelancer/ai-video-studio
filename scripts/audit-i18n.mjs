// Is there any interface text left that no catalogue can reach?
//
//   node scripts/audit-i18n.mjs            # report; exit 1 if anything is unreachable
//   node scripts/audit-i18n.mjs --verbose  # print every finding, not the first few
//
// "Unreachable" is the only thing measured here. A Vietnamese string is fine — Vietnamese IS the
// source language — as long as some catalogue key can replace it. What this catches is the string
// no key can ever name, which is the one that stays Vietnamese in a Japanese interface.
import { readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANG_CODES } from '../src/i18n/languages.js';
import { walk, literals, reachable, tpCovered, looksVietnamese, exemptLines, ATTRS } from './lib/i18n-scan.mjs';
import { stripComments } from './lib/msgid.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERBOSE = process.argv.includes('--verbose');
const rel = (p) => relative(ROOT, p);

// Text that is deliberately the same in every language: a brand, a machine literal a person types
// back verbatim, a language's own endonym in the picker that chooses it.
const NEVER_TRANSLATED = [
  /^AI Video Studio$/, /^TuiLa1Freelancer$/, /^by TuiLa1Freelancer$/,
  /^[\d.,:×x/\s]+$/, /^(?:16:9|9:16|4:5|1:1)/,
  // A number with the unit printed beside it. The unit is a symbol, not a word to translate.
  /^[\d.,\s]*(?:%|dB|ms|s|px|fps|p|K|MB|GB|×)$/i,
  /^https?:\/\//, /^sk-/, /^~\//, /^[a-z0-9-]+\/[a-z0-9-]+$/i,
  /^(?:Client ID|Client Secret|Page ID|Page Access Token|Base URL|TOOLS-)/,
  // eslint-disable-next-line no-misleading-character-class -- ZWJ/VS16 belong in the emoji class
  /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s‍️●○▶◀·—–|]+$/u,
];
// A Vietnamese word outranks every rule above it: `~/Movies/AI Video Studio/ten-kenh` is a path
// AND a label, and the path rule alone hid it for a whole sweep.
const skip = (s) => {
  const t = s.trim();
  if (!t) return true;
  if (looksVietnamese(t)) return false;
  return NEVER_TRANSLATED.some((re) => re.test(t));
};

// Every Vietnamese string the catalogue already holds. A literal equal to one of them is reachable
// by definition — it is in the file the translator is given.
const SOURCE_CATALOGUE = JSON.parse(readFileSync(join(ROOT, 'public', 'locales', 'vi.json'), 'utf8'));
const CATALOGUE_VALUES = new Set(Object.values(SOURCE_CATALOGUE));
const CATALOGUE_KEYS = new Set(Object.keys(SOURCE_CATALOGUE));

const findings = { markup: [], browser: [], server: [], serverAnyLang: [], catalogue: [] };

// ---- 1. public/index.html: a node a person reads, with no key on it ----------------------------
{
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const text = /(>)([^<>]+)(<)/g;
  let hit;
  while ((hit = text.exec(body))) {
    const s = hit[2].trim();
    if (skip(s) || s.length < 2) continue;
    const open = body.slice(body.lastIndexOf('<', hit.index), hit.index + 1);
    if (/data-i18n/.test(open)) continue;   // data-i18n-exempt counts: it is a decision, recorded
    // An <option> in the interface-language picker names a language in its OWN script on purpose.
    if (/<option value="(?:en|vi|fr|de|es|pt|hi|ja|ko|zh|th|id|ru)"/.test(open)) continue;
    findings.markup.push({ what: `text "${s.slice(0, 60)}"` });
  }
  for (const tag of body.matchAll(/<[a-zA-Z][\w-]*[^>]*>/g)) {
    for (const a of ATTRS) {
      const v = tag[0].match(new RegExp(`(?<![\\w-])${a}="([^"]*)"`));
      if (!v || skip(v[1])) continue;
      if (new RegExp(`data-i18n-${a}=`).test(tag[0])) continue;
      if (!looksVietnamese(v[1])) continue;   // a machine literal in a placeholder stays as typed
      findings.markup.push({ what: `@${a}="${v[1].slice(0, 60)}"` });
    }
  }
}

// ---- 2 & 3. a module's own strings ------------------------------------------------------------
function scanModules(dir, bucket, ignore) {
  for (const file of walk(join(ROOT, dir))) {
    if (ignore(rel(file))) continue;
    const src = readFileSync(file, 'utf8');
    const covered = reachable(src);
    const inTagged = tpCovered(src);
    const exempt = exemptLines(src);
    for (const l of literals(src)) {
      if (skip(l.text) || covered.has(l.text) || inTagged(l.index) || exempt.has(l.line)) continue;
      // Already a value in the catalogue: some t() call put it there, in a shape no pattern here
      // has to recognise — `t(\`ui.status.${s}\`, null, BADGE[s])` reaches seven of them at once.
      if (CATALOGUE_VALUES.has(l.text)) continue;
      // A template with a placeholder is only ever reachable by being tagged with tp.
      findings[bucket].push({ file: rel(file), line: l.line, text: l.text.slice(0, 70) });
    }
  }
}
scanModules('public/js', 'browser', (f) => f.endsWith('views/guide.js'));   // the manual has its own catalogue
// src/ is mostly LLM prompts and language data, which must stay Vietnamese — auditing those would
// report the engine's own input as a defect. What IS audited is every module that describes the
// app to its owner: the progress ticker, the error classes, the request services, and the two
// catalogues Settings renders (the TTS providers and the publishing targets).
const SERVER_UI = /^src\/(?:pipeline\/progress|core\/errors|api\/services\/|providers\/voice\/|publish\/)/;
scanModules('src', 'server', (f) => !SERVER_UI.test(f));

// ---- 4. a server string in a position that REACHES the owner, in any language -------------------
// The checks above ask whether a string looks Vietnamese. This one does not care: an English
// sentence thrown as an error is exactly as untranslated to a Japanese owner as a Vietnamese one,
// and the position it sits in — an HTTP error body, a thrown Error — already proves it is shown.
{
  // Matched by KEY, not by value: `srv.not found` holds "không tìm thấy", so the English it was
  // minted from is no longer any catalogue's value — and it is still perfectly reachable.
  const POSITIONS = [
    /\b(?:error|message|hint)\s*:\s*'([^'\\\n]{4,200})'/g,
    /\b(?:error|message|hint)\s*:\s*"([^"\\\n]{4,200})"/g,
    /\bfailed\(\s*'[^']*'\s*,\s*'([^'\\\n]{4,200})'/g,
    /\bthrow new Error\(\s*'([^'\\\n]{4,200})'/g,
    /\bthrow new Error\(\s*"([^"\\\n]{4,200})"/g,
  ];
  for (const file of walk(join(ROOT, 'src'))) {
    if (rel(file).startsWith('src/i18n/')) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    const exempt = exemptLines(readFileSync(file, 'utf8'));
    for (const re of POSITIONS) {
      for (const hit of src.matchAll(re)) {
        const text = hit[1];
        if (CATALOGUE_KEYS.has(`srv.${text}`) || !/[A-Za-z]/.test(text) || !/\s/.test(text)) continue;
        if (/^[A-Z0-9_.:/-]+$/.test(text)) continue;          // a code, not a sentence
        const line = src.slice(0, hit.index).split('\n').length;
        if (exempt.has(line)) continue;
        findings.serverAnyLang.push({ file: rel(file), line, text: text.slice(0, 70) });
      }
    }
  }
}

// ---- 4. every language has every key ----------------------------------------------------------
{
  const base = JSON.parse(readFileSync(join(ROOT, 'public', 'locales', 'vi.json'), 'utf8'));
  const guide = JSON.parse(readFileSync(join(ROOT, 'public', 'locales', 'guide.vi.json'), 'utf8'));
  for (const code of LANG_CODES) {
    for (const [name, src] of [[`${code}.json`, base], [`guide.${code}.json`, guide]]) {
      let cat;
      try { cat = JSON.parse(readFileSync(join(ROOT, 'public', 'locales', name), 'utf8')); }
      catch { findings.catalogue.push({ what: `${name} missing or unreadable` }); continue; }
      const missing = Object.keys(src).filter((k) => !(k in cat));
      const extra = Object.keys(cat).filter((k) => !(k in src));
      if (missing.length) findings.catalogue.push({ what: `${name} missing ${missing.length} keys (e.g. ${missing[0]})` });
      if (extra.length) findings.catalogue.push({ what: `${name} has ${extra.length} keys vi.json does not (e.g. ${extra[0]})` });
    }
  }
}

// ---- report -----------------------------------------------------------------------------------
const LABEL = {
  markup: 'public/index.html — text a person reads with no data-i18n key',
  browser: 'public/js — interface strings no catalogue can reach',
  server: 'src — owner-facing strings no catalogue can reach',
  serverAnyLang: 'src — errors the owner is shown, in any language, with no catalogue entry',
  catalogue: 'public/locales — catalogues out of step with vi.json',
};
let total = 0;
for (const [bucket, rows] of Object.entries(findings)) {
  total += rows.length;
  const mark = rows.length ? '✗' : '✓';
  console.log(`${mark} ${LABEL[bucket]}: ${rows.length}`);
  for (const r of (VERBOSE ? rows : rows.slice(0, 8))) {
    console.log(`    ${r.file ? `${r.file}:${r.line}  ` : ''}${r.what ?? JSON.stringify(r.text)}`);
  }
  if (!VERBOSE && rows.length > 8) console.log(`    … ${rows.length - 8} more (--verbose)`);
}
console.log(total ? `\n${total} unreachable — the interface cannot be fully translated` : '\nnothing unreachable — every interface string can be translated');
process.exit(total ? 1 : 0);
