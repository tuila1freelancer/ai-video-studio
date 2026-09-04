// Server strings that reach the interface, keyed by their own Vietnamese text.
//
// An HTTP error body and a pipeline stage name are shown to the owner verbatim, so they need
// translating — but there are 58 of the first alone, and rewriting 58 call sites to pass a key
// buys nothing a lookup at the egress does not. The Vietnamese string IS the key (the gettext
// model): nothing at the call site changes, a string with no translation shows its Vietnamese,
// and adding one later needs no code at all.
//
// Only NON-interpolated strings qualify — a template that has already been filled in cannot be
// looked up. Those are reported so the count is honest rather than quietly rounded down.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
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
const PATTERNS = [
  /\b(?:error|message|hint)\s*:\s*'([^'\\]{4,200})'/g,
  /\b(?:error|message|hint)\s*:\s*"([^"\\]{4,200})"/g,
];

// `label:`, `name:` and `note:` are interface text in a CATALOGUE and DATA everywhere else — a
// voice's name, a channel's name, a project's name are the owner's own words. So these patterns
// run only against the files that describe the app to itself.
const CATALOGUE_FILES = /providers\/(voice\/|llm-presets)|publish\/platforms|subtitles\/presets|styleguide\/presets/;
const CATALOGUE_PATTERNS = [
  /\b(?:label|note|placeholder)\s*:\s*'([^'\\]{3,200})'/g,
  /\b(?:label|note|placeholder)\s*:\s*"([^"\\]{3,200})"/g,
];
// `name:` is interface text on a PROVIDER and a proper noun on a VOICE — "Duy Phương (Huế · nam)"
// is that voice's actual name and must read the same to a Japanese owner picking it. The voice
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
        if (!VN.test(text)) continue;
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

  const merged = { ...catalogue };
  for (const [k, v] of found) merged[k] = v;
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  console.log(`${found.size} server strings keyable by their own text · ${interpolated} interpolated (left in Vietnamese)`);
  console.log(`catalogue ${Object.keys(catalogue).length} → ${Object.keys(sorted).length} keys`);
  if (!WRITE) return console.log('(dry run — pass --write to apply)');
  writeFileSync(CATALOGUE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log('written');
}

run();
