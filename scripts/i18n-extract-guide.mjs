// The in-app manual, as data a translator can be handed.
//
// public/guide/sections.json is 40KB of Vietnamese prose — the largest single body of text in
// the interface and the one most likely to be edited. Keying every string inside it by hand would
// make the file unreadable and every future edit a two-file job.
//
// So the JSON stays the authored source, and this flattens it by JSON path into
// public/locales/guide.vi.json. The runtime rehydrates a translated copy over the same shape, so
// a translated manual can never have a different set of chapters from the Vietnamese one.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'public', 'guide', 'sections.json');
const OUT = join(ROOT, 'public', 'locales', 'guide.vi.json');

/** The authored chapters. Strict JSON: a stray comment or trailing comma is a parse error here. */
export function sectionsFromSource(src) {
  const sections = JSON.parse(src);
  if (!Array.isArray(sections) || !sections.length) throw new Error('public/guide/sections.json holds no chapters');
  return sections;
}

/**
 * Flatten by the manual's OWN grammar rather than by field name.
 *
 * A name-based whitelist cannot work here: `t` is the block TYPE on a block and the body TEXT on
 * a step or a card, `i` is an emoji, and the first half of a keys row is a keyboard shortcut that
 * must survive translation exactly. The grammar is short enough to write down.
 */
export function flatten(sections) {
  const out = {};
  const put = (k, v) => { if (typeof v === 'string' && v.trim()) out[k] = v; };
  sections.forEach((s, si) => {
    put(`${si}.grp`, s.grp);
    put(`${si}.title`, s.title);
    put(`${si}.lede`, s.lede);
    (s.blocks || []).forEach((b, bi) => {
      const p = `${si}.blocks.${bi}`;
      // A `code` block is a command to paste. Translating it would break it.
      if (b.t !== 'code') put(`${p}.text`, b.text);
      (b.items || []).forEach((it, ii) => {
        const q = `${p}.items.${ii}`;
        if (typeof it === 'string') return put(q, it);          // list
        if (Array.isArray(it)) {
          // keys: ["⌘ K", "what it does"] — the shortcut is not language.
          if (b.t !== 'keys') put(`${q}.0`, it[0]);
          return put(`${q}.1`, it[1]);
        }
        put(`${q}.n`, it.n);       // steps: the step's name
        put(`${q}.t`, it.t);       // steps + grid: the body
        put(`${q}.d`, it.d);       // grid: the description
        put(`${q}.label`, it.label); // go: the button
      });
    });
  });
  return out;
}

/** Put translated strings back on the SAME shape — structure always comes from the source. */
export function rehydrate(sections, flat) {
  const clone = JSON.parse(JSON.stringify(sections));
  for (const [path, value] of Object.entries(flat || {})) {
    const parts = path.split('.');
    let node = clone;
    for (let i = 0; i < parts.length - 1 && node; i++) node = node[parts[i]];
    if (node && typeof value === 'string') node[parts[parts.length - 1]] = value;
  }
  return clone;
}

if (process.argv[1] && process.argv[1].endsWith('i18n-extract-guide.mjs')) {
  const sections = sectionsFromSource(readFileSync(SRC, 'utf8'));
  const flat = flatten(sections);
  writeFileSync(OUT, `${JSON.stringify(flat, null, 2)}\n`);
  console.log(`${sections.length} chapters · ${Object.keys(flat).length} strings → public/locales/guide.vi.json`);
}
