// Read a source file for the tests that assert on its TEXT.
//
// Those tests pin behaviour they cannot reach any other way — that a failed upload raises a toast,
// that the join announces how long it took. The sentence is the evidence, so the assertion quotes
// it. Wrapping that sentence for translation does not change the behaviour, but it does change the
// text, which broke ten of these at once the first time it happened.
//
// So the wrappers come off before matching: `m('…')` and `tp\`…\`` read as the plain string and the
// plain template they stand for, and an assertion goes on quoting the sentence the owner sees.
//
// The second thing that breaks these tests is a file being SPLIT. `RELOCATED` maps a path that no
// longer holds everything it used to onto the files it became, in their original top-to-bottom
// order, and `sourceOf()` hands back their concatenation — so an anchor written against the old
// file keeps matching, and an order-dependent assertion (`indexOf(a) < indexOf(b)`) keeps its
// meaning as long as both markers moved into the same file. Splitting a file is one entry here.
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

/** Old path → the files it was split into, in the order the old file had them. */
export const RELOCATED = {};

/** `m('x')` → `'x'`, `tp\`x\`` → `` `x` ``. Nothing else is touched. */
export function unwrapI18n(code) {
  return String(code)
    .replace(/\bm\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, "'$1'")
    .replace(/\bm\(\s*"((?:\\.|[^"\\])*)"\s*\)/g, '"$1"')
    .replace(/(?<![\w.$])tp`/g, '`');
}

const readRoot = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

/** The source at `rel` (repo-root relative), following `RELOCATED`, with the i18n wrappers removed. */
export function sourceOf(rel) {
  const parts = RELOCATED[rel] || [rel];
  return unwrapI18n(parts.map(readRoot).join('\n'));
}

/** The interface markup as the browser receives it. */
export function indexHtml() {
  return readRoot('public/index.html');
}

/** The source of `path`, relative to the CALLER, with the i18n wrappers removed. */
export function source(path, base) {
  return unwrapI18n(readFileSync(new URL(path, base), 'utf8'));
}
