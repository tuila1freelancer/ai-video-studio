// Pull msgids out of the two helpers that key a string by its own Vietnamese text.
//
//   m('Đã xong')                → "Đã xong"
//   tp`Đã ghép ${n} cảnh`       → "Đã ghép {0} cảnh"
//
// A tagged template is scanned character by character rather than by regex: `${fmt(`${x}`)}` nests
// backticks inside its own placeholder, and a regex that stops at the first backtick truncates the
// sentence — producing a msgid that never matches at runtime.

/**
 * Blank out comments, keeping every byte offset.
 *
 * Without this a `tp\`…\`` written in a doc comment as an EXAMPLE becomes a catalogue key — which
 * is exactly what happened the first time these two helpers were documented.
 */
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === q) { out += q; i++; break; }
        out += src[i]; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Every `m('…')` / `m("…")` literal in `src`. */
export function msgCalls(raw) {
  const src = stripComments(raw);
  const out = [];
  for (const re of [/(?<![\w.$])m\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, /(?<![\w.$])m\(\s*"((?:\\.|[^"\\])*)"\s*\)/g]) {
    for (const hit of src.matchAll(re)) out.push(hit[1].replace(/\\(['"\\])/g, '$1'));
  }
  return out;
}

/** Every tp`…` template in `src`, with its placeholders collapsed to {0}, {1}, … */
export function tpTemplates(raw) {
  const src = stripComments(raw);
  const out = [];
  const start = /(?<![\w.$])tp`/g;
  let hit;
  while ((hit = start.exec(src))) {
    let i = start.lastIndex;
    let msgid = '';
    let n = 0;
    let closed = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { msgid += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { closed = true; i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        // Skip the expression, counting braces and stepping over nested strings/templates.
        let depth = 1;
        i += 2;
        while (i < src.length && depth) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '{') depth++;
          else if (d === '}') depth--;
          else if (d === '`' || d === "'" || d === '"') {
            const q = d;
            i++;
            while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
          }
          i++;
        }
        msgid += `{${n++}}`;
        continue;
      }
      msgid += c;
      i++;
    }
    if (closed) out.push(msgid);
    start.lastIndex = i;
  }
  return out;
}
