// Which strings in the source are REACHABLE by a catalogue, and which are not.
//
// Shared by the audit command and its test, so the number the audit prints and the number CI
// enforces can never drift apart.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments, msgCalls, tpTemplates } from './msgid.mjs';

export const VN = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
export const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Vietnamese that carries no diacritic at all. These read as English to a regex and as Vietnamese
// to a reader, which is exactly why they survived the first pass: `HOA` is "uppercase", `song song`
// is "parallel", `vd` is "ví dụ", `ngang` is "landscape".
const VN_PLAIN = /(?:^|[\s"'>(])(?:vd:|HOA|song song|Canh ngang|ten-kenh|Theo style guide|ngang(?:$|[\s"'<),.]))/;

/** True when a string a person will read is spelled with no Vietnamese diacritic. */
export function looksVietnamese(s) { return VN.test(s) || VN_PLAIN.test(s); }

/**
 * Every position where a browser or server module makes a string translatable.
 *
 * The four are not interchangeable: the first two translate the string where it is DRAWN and so
 * cover a call site that was never edited, the last two are written at the call site itself.
 */
export function reachable(rawSrc) {
  const src = stripComments(rawSrc);
  const set = new Set();
  // t('key', params, 'default') — the default is the Vietnamese
  for (const re of [/\bt\(\s*'[^']*'\s*,[^,)]*,\s*'((?:\\.|[^'\\])*)'/g, /\bt\(\s*"[^"]*"\s*,[^,)]*,\s*"((?:\\.|[^"\\])*)"/g]) {
    for (const hit of src.matchAll(re)) set.add(hit[1]);
  }
  // toast('…') and a dialog's own fields translate themselves where they are drawn
  for (const re of [
    /\btoast\(\s*'([^'\\\n]{3,200})'/g, /\btoast\(\s*"([^"\\\n]{3,200})"/g,
    /\b(?:title|label|okText|cancelText|body|placeholder)\s*:\s*'([^'\\\n]{3,200})'/g,
    /\b(?:title|label|okText|cancelText|body|placeholder)\s*:\s*"([^"\\\n]{3,200})"/g,
    /\b(?:error|message|hint)\s*:\s*'([^'\\\n]{4,200})'/g,
    /\b(?:error|message|hint)\s*:\s*"([^"\\\n]{4,200})"/g,
  ]) for (const hit of src.matchAll(re)) set.add(hit[1]);
  for (const text of msgCalls(rawSrc)) set.add(text);
  for (const text of tpTemplates(rawSrc)) set.add(text);
  return set;
}

/** Every string literal in `src` that a person could read, with the line it sits on. */
export function literals(rawSrc) {
  const src = stripComments(rawSrc);
  const out = [];
  const lit = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let hit;
  while ((hit = lit.exec(src))) {
    const [, quote, body] = hit;
    if (!looksVietnamese(body)) continue;
    out.push({ text: body, quote, line: src.slice(0, hit.index).split('\n').length, index: hit.index });
  }
  return out;
}

/**
 * A template literal is reachable once it is tagged, so its RESULT never has to match anything.
 * Its own placeholder expressions, though, are ordinary code that may contain further literals —
 * so a tagged template's static text is covered while the code inside `${…}` still is not.
 */
export function tpCovered(rawSrc) {
  const src = stripComments(rawSrc);
  const spans = [];
  const start = /(?<![\w.$])tp`/g;
  let hit;
  while ((hit = start.exec(src))) {
    let i = start.lastIndex;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; break; }
      i++;
    }
    spans.push([hit.index, i]);
    start.lastIndex = i;
  }
  return (index) => spans.some(([a, b]) => index >= a && index < b);
}
