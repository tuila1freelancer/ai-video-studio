// Read a source file for the tests that assert on its TEXT.
//
// Those tests pin behaviour they cannot reach any other way — that a failed upload raises a toast,
// that the join announces how long it took. The sentence is the evidence, so the assertion quotes
// it. Wrapping that sentence for translation does not change the behaviour, but it does change the
// text, which broke ten of these at once the first time it happened.
//
// So the wrappers come off before matching: `m('…')` and `tp\`…\`` read as the plain string and the
// plain template they stand for, and an assertion goes on quoting the sentence the owner sees.
import { readFileSync } from 'node:fs';

/** `m('x')` → `'x'`, `tp\`x\`` → `` `x` ``. Nothing else is touched. */
export function unwrapI18n(code) {
  return String(code)
    .replace(/\bm\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, "'$1'")
    .replace(/\bm\(\s*"((?:\\.|[^"\\])*)"\s*\)/g, '"$1"')
    .replace(/(?<![\w.$])tp`/g, '`');
}

/** The source of `path`, relative to the CALLER, with the i18n wrappers removed. */
export function source(path, base) {
  return unwrapI18n(readFileSync(new URL(path, base), 'utf8'));
}
