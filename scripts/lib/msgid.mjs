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
  // A `/` opens a regex only where a VALUE may start; anywhere else it is division.
  const opensValue = (before) => {
    const t = before.replace(/\s+$/, '');
    if (!t) return true;
    if (/[=(,:[!&|?{};+\-*%~^]$/.test(t)) return true;
    return /\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(t);
  };

  // Code and template text are two different languages sharing one file, and `${…}` switches
  // between them any number of levels deep. A scanner that treats a template as a plain string
  // ends the outer one at the INNER template's opening backtick — after which `</div>` is read as
  // code, `/div>…/` as a regex, and every offset downstream is wrong.
  const frames = [{ tpl: false, hole: false, depth: 0 }];
  let out = '';
  let i = 0;
  while (i < src.length) {
    const f = frames[frames.length - 1];

    if (f.tpl) {
      const c = src[i];
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { out += c; i++; frames.pop(); continue; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; frames.push({ tpl: false, hole: true, depth: 0 }); continue; }
      out += c; i++;
      continue;
    }

    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '/' && opensValue(out)) {
      // BLANK the regex, keeping its width: /("[^"]*"|'[^']*')/ carries unbalanced quotes, and a
      // scanner that reads them as string delimiters is one quote out of step for the rest of the
      // file. A regex body is never translatable text.
      out += ' '; i++;
      let inClass = false;
      while (i < src.length) {
        const r = src[i];
        if (r === '\\') { out += '  '; i += 2; continue; }
        if (r === '\n') break;                    // unterminated: it was division after all
        out += ' '; i++;
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
      }
      while (i < src.length && /[gimsuyvd]/.test(src[i])) { out += ' '; i++; }
      continue;
    }
    if (c === '`') { out += c; i++; frames.push({ tpl: true, hole: false, depth: 0 }); continue; }
    if (c === '"' || c === "'") {
      out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === c) { out += c; i++; break; }
        if (src[i] === '\n') break;               // unterminated: do not swallow the whole file
        out += src[i]; i++;
      }
      continue;
    }
    if (c === '{') f.depth++;
    else if (c === '}') {
      if (f.hole && f.depth === 0) { out += '}'; i++; frames.pop(); continue; }
      f.depth--;
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

/**
 * Every tp`…` template in `src`, with its placeholders collapsed to {0}, {1}, …
 *
 * Scanned character by character rather than by regex: `${fmt(`${x}`)}` nests backticks inside its
 * own placeholder, and a regex that stops at the first backtick truncates the sentence into a
 * msgid that never matches at runtime. And the placeholders are scanned in TURN, because a tp
 * inside another tp's placeholder is an ordinary msgid that would otherwise be silently dropped.
 */
export function tpTemplates(raw) {
  const src = stripComments(raw);
  const out = [];
  const scan = (from, to) => {
    const start = /(?<![\w.$])tp`/g;
    start.lastIndex = from;
    let hit;
    while ((hit = start.exec(src)) && hit.index < to) {
      let i = start.lastIndex;
      let msgid = '';
      let n = 0;
      let closed = false;
      const holes = [];
      while (i < to) {
        const c = src[i];
        if (c === '\\') { msgid += src.slice(i, i + 2); i += 2; continue; }
        if (c === '`') { closed = true; i++; break; }
        if (c === '$' && src[i + 1] === '{') {
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
          msgid += `{${n++}}`;
          continue;
        }
        msgid += c;
        i++;
      }
      if (closed) out.push(msgid);
      for (const [a, b] of holes) scan(a, b);
      start.lastIndex = i;
    }
  };
  scan(0, src.length);
  return out;
}
