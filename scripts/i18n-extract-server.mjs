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

// `error: '…'` and `message: '…'` in an HTTP body, and the stage-name table.
const PATTERNS = [
  /\b(?:error|message|hint)\s*:\s*'([^'\\]{4,200})'/g,
  /\b(?:error|message|hint)\s*:\s*"([^"\\]{4,200})"/g,
];

function run() {
  const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const found = new Map();
  let interpolated = 0;

  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const text = m[1];
        if (!VN.test(text)) continue;
        if (text.includes('${')) { interpolated++; continue; }
        found.set(`srv.${text}`, text);
      }
    }
    // A template literal that carries Vietnamese AND a placeholder cannot be keyed by its result.
    for (const m of src.matchAll(/`[^`]*\$\{[^`]*`/g)) if (VN.test(m[0])) interpolated++;
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
