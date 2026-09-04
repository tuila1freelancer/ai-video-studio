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
    // setLabel(el, icon, fallback) takes its text from the element's OWN data-i18n key; the third
    // argument is only what shows if the element carries none.
    /\bsetLabel\((?:[^()]|\([^()]*\))*?'([^'\\\n]{2,200})'\s*\)/g,
    /\bsetLabel\((?:[^()]|\([^()]*\))*?"([^"\\\n]{2,200})"\s*\)/g,
  ]) for (const hit of src.matchAll(re)) set.add(hit[1]);
  for (const text of msgCalls(rawSrc)) set.add(text);
  for (const text of tpTemplates(rawSrc)) set.add(text);
  return set;
}

/**
 * Every string a person could read, with the line it sits on.
 *
 * A template literal is scanned as its STATIC parts only, and the code inside each `${…}` is
 * scanned in turn — because `<div>${m('Chưa có mục nào')}</div>` is a translated string, and
 * reading the template as one flat run reports it as an untranslated one.
 */
export function literals(rawSrc) {
  const src = stripComments(rawSrc);
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;

  const scan = (from, to) => {
    let i = from;
    while (i < to) {
      const c = src[i];
      if (c !== '"' && c !== "'" && c !== '`') { i++; continue; }
      const open = i;
      const quote = c;
      i++;
      if (quote !== '`') {
        let body = '';
        while (i < to) {
          if (src[i] === '\\') { body += src[i + 1] ?? ''; i += 2; continue; }
          if (src[i] === quote) { i++; break; }
          body += src[i]; i++;
        }
        if (looksVietnamese(body)) out.push({ text: body, quote, line: lineAt(open), index: open });
        continue;
      }
      // A template: collect the static run, and recurse through every ${…} expression.
      let statics = '';
      const holes = [];
      while (i < to) {
        if (src[i] === '\\') { statics += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          const exprFrom = i + 2;
          let depth = 1;
          i += 2;
          while (i < to && depth) {
            const d = src[i];
            if (d === '\\') { i += 2; continue; }
            if (d === '{') depth++;
            else if (d === '}') depth--;
            else if (d === '`' || d === "'" || d === '"') {
              const q = d;
              i++;
              while (i < to && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
            }
            i++;
          }
          holes.push([exprFrom, i - 1]);
          statics += '\u0000';
          continue;
        }
        statics += src[i]; i++;
      }
      if (looksVietnamese(statics.replace(/\u0000/g, ''))) {
        out.push({ text: statics.replace(/\u0000/g, '…'), quote: '`', line: lineAt(open), index: open });
      }
      for (const [a, b] of holes) scan(a, b);
    }
  };
  scan(0, src.length);
  return out.sort((a, b) => a.index - b.index);
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

/**
 * Lines a `// i18n-exempt` comment covers: from the marker down to the next blank line.
 *
 * The decision to leave a string alone belongs next to the string, not in a list inside the audit
 * that nobody reads when they move the code. The blank line is the scope because that is already
 * how a declaration is separated from its neighbours in this repo.
 */
export function exemptLines(rawSrc) {
  const out = new Set();
  const lines = rawSrc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/i18n-exempt/.test(lines[i])) continue;
    for (let j = i; j < lines.length && lines[j].trim(); j++) out.add(j + 1);
  }
  return out;
}
