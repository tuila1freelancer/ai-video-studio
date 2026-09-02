// Pull every Vietnamese string out of index.html into the catalogue, and tag its node.
//
// 530 text nodes and 92 attributes: doing that by hand is a guarantee of a missed one, and a
// missed one is a Vietnamese word sitting in an otherwise Japanese interface. So it is a tool,
// and it is idempotent — run it again after adding UI and it only picks up what is new.
//
// Keys are `ui.<nearest ancestor id>.<slug of the text>`. Position would be shorter and would
// silently re-point every translation the first time somebody moves a block; a slug of the source
// text survives reordering, reads like what it is in the catalogue, and changes when the source
// changes — which is exactly when a translation should be re-done.
//
//   node scripts/i18n-extract.mjs           # report what would change
//   node scripts/i18n-extract.mjs --write   # tag index.html and write public/locales/vi.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HTML = join(ROOT, 'public', 'index.html');
const CATALOGUE = join(ROOT, 'public', 'locales', 'vi.json');
const WRITE = process.argv.includes('--write');

const VN = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 34) || 'x';

/** Walk the raw markup, tracking which id-bearing element we are inside. */
function scopes(html) {
  const stack = [];
  const out = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'use', 'ellipse']);
  let m;
  while ((m = tag.exec(html))) {
    const [full, close, name, attrs, selfClose] = m;
    if (close) { if (stack.length && stack[stack.length - 1].name === name) stack.pop(); continue; }
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    out.push({ index: m.index, end: m.index + full.length, name, attrs, scope: stack.length ? stack[stack.length - 1].id : 'app', full });
    if (!selfClose && !VOID.has(name.toLowerCase())) stack.push({ name, id: id || (stack.length ? stack[stack.length - 1].id : 'app') });
  }
  return out;
}

function run() {
  let html = readFileSync(HTML, 'utf8');
  const existing = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const found = new Map();     // key → Vietnamese source text
  const used = new Set(Object.keys(existing));
  const edits = [];            // { at, insert }  applied right-to-left

  const keyFor = (scope, text) => {
    const base = `ui.${scope}.${slug(text)}`;
    if (!used.has(base) && !found.has(base)) return base;
    if (found.get(base) === text) return base;
    let n = 2;
    while (found.has(`${base}-${n}`) && found.get(`${base}-${n}`) !== text) n++;
    return `${base}-${n}`;
  };

  const tags = scopes(html);
  // --- attributes ---
  for (const tg of tags) {
    if (/\bdata-i18n/.test(tg.attrs)) continue;
    for (const a of ATTRS) {
      const m = tg.attrs.match(new RegExp(`\\b${a}="([^"]*)"`));
      if (!m || !VN.test(m[1])) continue;
      const key = keyFor(tg.scope, m[1]);
      found.set(key, m[1]);
      edits.push({ at: tg.end - (tg.full.endsWith('/>') ? 2 : 1), insert: ` data-i18n-${a}="${key}"` });
    }
  }
  // --- text nodes: only LEAF text, so an element wrapping other elements is never keyed whole ---
  const text = /(>)([^<>]+)(<)/g;
  let m;
  while ((m = text.exec(html))) {
    const raw = m[2];
    if (!VN.test(raw)) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // The run may follow an OPEN tag (`<b>text`) or a CLOSE tag (`</span> text`, which is how
    // every switch label is written). Both are translatable; only the first can be tagged in place.
    const open = [...tags].reverse().find((tg) => tg.end === m.index + 1);
    if (open && /\bdata-i18n/.test(open.attrs)) continue;
    const scope = (open || [...tags].filter((tg) => tg.index < m.index).pop() || { scope: 'app' }).scope;
    const closeTag = open ? html.indexOf(`</${open.name}`, open.end) : -1;
    const wholeContent = !!open && closeTag >= 0 && html.slice(open.end, closeTag).trim() === trimmed;
    const key = keyFor(scope, trimmed);
    found.set(key, trimmed);
    if (wholeContent) {
      // The element's entire content — tag the element and replace its text at runtime.
      edits.push({ at: open.end - (open.full.endsWith('/>') ? 2 : 1), insert: ` data-i18n="${key}"` });
    } else {
      // Mixed content, e.g. `<button><svg/>Nhãn</button>`. Tagging the button would make the
      // translation replace the icon too, so the text run becomes its own element instead.
      const lead = raw.slice(0, raw.indexOf(trimmed));
      const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
      edits.push({ at: m.index + 1, len: raw.length, insert: `${lead}<span data-i18n="${key}">${trimmed}</span>${tail}` });
    }
  }

  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) html = html.slice(0, e.at) + e.insert + html.slice(e.at + (e.len || 0));

  const merged = { ...existing };
  for (const [k, v] of found) merged[k] = v;
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));

  console.log(`${found.size} strings tagged · catalogue ${Object.keys(existing).length} → ${Object.keys(sorted).length} keys`);
  if (!WRITE) return console.log('(dry run — pass --write to apply)');
  writeFileSync(HTML, html);
  writeFileSync(CATALOGUE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log('written');
}

run();
