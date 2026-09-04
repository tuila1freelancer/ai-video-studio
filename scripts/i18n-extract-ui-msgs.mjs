// Toast and dialog text, keyed by its own Vietnamese — the last surface that was still Vietnamese
// in a translated interface.
//
// toast() and the dialogs translate their message at the ONE place it is drawn (the gettext
// model), so none of the 230 toast call sites and 45 dialog call sites had to change. This finds
// the literals they are called with and puts them in the catalogue.
//
// A message assembled by interpolation cannot be keyed by its result and keeps its Vietnamese.
// That number is printed rather than hidden, because it is the honest measure of what is left.
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

// A literal argument to toast(), or a literal title/label/okText on a dialog.
const CALLS = [
  /\btoast\(\s*'([^'\\\n]{3,200})'/g,
  /\btoast\(\s*"([^"\\\n]{3,200})"/g,
  /\b(?:title|label|okText|cancelText|body|placeholder)\s*:\s*'([^'\\\n]{3,200})'/g,
  /\b(?:title|label|okText|cancelText|body|placeholder)\s*:\s*"([^"\\\n]{3,200})"/g,
];

function run() {
  const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const found = new Map();
  let interpolated = 0;

  for (const file of walk(join(ROOT, 'public', 'js'))) {
    // guide.js's SECTIONS is the manual's authored SOURCE and has its own catalogue.
    if (file.endsWith('views/guide.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const re of CALLS) {
      for (const m of src.matchAll(re)) if (VN.test(m[1])) found.set(`ui.msg.${m[1]}`, m[1]);
    }
    // m('…') and tp`…` DECLARE a string to be interface text, so no diacritic test applies: the
    // author already said what it is. '● offline' carries no Vietnamese and still has to translate.
    for (const text of msgCalls(src)) found.set(`ui.msg.${text}`, text);
    for (const text of tpTemplates(src)) found.set(`ui.msg.${text}`, text);
    for (const m of src.matchAll(/\btoast\(\s*`[^`]*\$\{[^`]*`/g)) if (VN.test(m[0]) && !/\btp`/.test(m[0])) interpolated++;
  }

  const merged = { ...catalogue };
  for (const [k, v] of found) merged[k] = v;
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  console.log(`${found.size} messages keyable by their own text · ${interpolated} interpolated toasts left in Vietnamese`);
  console.log(`catalogue ${Object.keys(catalogue).length} → ${Object.keys(sorted).length} keys`);
  if (!WRITE) return console.log('(dry run — pass --write to apply)');
  writeFileSync(CATALOGUE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log('written');
}

run();
