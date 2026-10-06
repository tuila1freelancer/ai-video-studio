// Server strings that reach the interface, keyed by their own Vietnamese text.
//
// An HTTP error body and a pipeline stage name are shown to the user verbatim, so they need
// translating — but there are 58 of the first alone, and rewriting 58 call sites to pass a key
// buys nothing a lookup at the egress does not. The Vietnamese string IS the key (the gettext
// model): nothing at the call site changes, a string with no translation shows its Vietnamese,
// and adding one later needs no code at all.
//
// Only NON-interpolated strings qualify — a template that has already been filled in cannot be
// looked up. Those are reported so the count is honest rather than quietly rounded down.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { msgCalls, tpTemplates } from './lib/msgid.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CATALOGUE = join(ROOT, 'public', 'locales', 'vi.json');
const WRITE = process.argv.includes('--write');
const VN = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// `error: '…'` and `message: '…'` in an HTTP body — anywhere.
//
// These take a string in ANY language, unlike the guesses further down. The position is already
// proof that the user is shown it, so there is nothing left to infer from the spelling — and
// `error: 'not found'` is exactly as untranslated to a Japanese user as a Vietnamese sentence is.
const PATTERNS = [
  /\b(?:error|message|hint)\s*:\s*'([^'\\]{4,200})'/g,
  /\b(?:error|message|hint)\s*:\s*"([^"\\]{4,200})"/g,
  // A thrown Error reaches the user the same way: the route catches it and answers
  // `{ error: e.message }`, which the egress then translates by that very text. So the message
  // needs no wrapper at the throw site — only a key here.
  /\bthrow new Error\(\s*'([^'\\]{4,200})'/g,
  /\bthrow new Error\(\s*"([^"\\]{4,200})"/g,
  /\bfailed\(\s*'[^']*'\s*,\s*'([^'\\]{4,200})'/g,
];

/** A sentence a person reads, rather than a code a machine matches. */
const READABLE = (t) => /[A-Za-zÀ-ỹ]/.test(t) && /\s/.test(t) && !/^[A-Z0-9_.:/-]+$/.test(t);

// `label:`, `name:` and `note:` are interface text in a CATALOGUE and DATA everywhere else — a
// voice's name, a channel's name, a project's name are the user's own words. So these patterns
// run only against the files that describe the app to itself.
const CATALOGUE_FILES = /providers\/(voice\/|llm-presets)|publish\/platforms|subtitles\/presets|styleguide\/presets/;
const CATALOGUE_PATTERNS = [
  /\b(?:label|note|placeholder)\s*:\s*'([^'\\]{3,200})'/g,
  /\b(?:label|note|placeholder)\s*:\s*"([^"\\]{3,200})"/g,
];
// `name:` is interface text on a PROVIDER and a proper noun on a VOICE — "Duy Phương (Huế · nam)"
// is that voice's actual name and must read the same to a Japanese user picking it. The voice
// modules carry both, so `name` is taken only from the files that describe no voices.
const NAME_FILES = /providers\/llm-presets|publish\/platforms|subtitles\/presets/;
const NAME_PATTERNS = [
  /\bname\s*:\s*'([^'\\]{3,200})'/g,
  /\bname\s*:\s*"([^"\\]{3,200})"/g,
];

function run() {
  const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const found = new Map();
  let interpolated = 0;

  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const patterns = [
      ...PATTERNS,
      ...(CATALOGUE_FILES.test(file) ? CATALOGUE_PATTERNS : []),
      ...(NAME_FILES.test(file) ? NAME_PATTERNS : []),
    ];
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const text = m[1];
        // An HTTP body's error/message/hint is shown whatever language it is written in; every
        // other pattern here is a guess about position and still needs the Vietnamese to confirm it.
        const httpBody = PATTERNS.includes(re);
        if (httpBody ? !READABLE(text) : !VN.test(text)) continue;
        if (text.includes('${')) { interpolated++; continue; }
        found.set(`srv.${text}`, text);
      }
    }
    // m('…') and tp`…` DECLARE a string to be interface text, wherever it sits and whatever it is
    // spelled with — the diacritic test above is for guessing, and here there is nothing to guess.
    for (const text of msgCalls(src)) found.set(`srv.${text}`, text);
    for (const text of tpTemplates(src)) found.set(`srv.${text}`, text);
    // A template literal that carries Vietnamese AND a placeholder cannot be keyed by its result.
    for (const m of src.matchAll(/`[^`]*\$\{[^`]*`/g)) if (VN.test(m[0]) && !/\btp`/.test(m[0])) interpolated++;
  }

  // Keep a value the catalogue already has. These keys ARE their own source text, so a changed
  // string is a changed KEY — which means an existing entry can only be a deliberate edit. That
  // is what lets the Vietnamese side of an ENGLISH message be written down: `srv.not found` can
  // hold "không tìm thấy" without the next extraction putting the English back.
  const merged = { ...catalogue };
  for (const [k, v] of found) if (!(k in merged)) merged[k] = v;
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  console.log(`${found.size} server strings keyable by their own text · ${interpolated} interpolated (left in Vietnamese)`);
  console.log(`catalogue ${Object.keys(catalogue).length} → ${Object.keys(sorted).length} keys`);
  if (!WRITE) return console.log('(dry run — pass --write to apply)');
  writeFileSync(CATALOGUE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log('written');
}

run();
