// ASS/libass subtitle builder for the final-pass lane.
//
// The scene lane draws captions as DOM inside every scene page, which makes them an INPUT to
// each clip: change the font and 95 clips go stale. The final lane renders the clips bare and
// burns the captions once, onto the assembled program — so a subtitle edit costs one concat
// instead of one render per scene.
//
// The bar this module has to clear is fidelity: the owner picks a style in a preview that is
// drawn by the browser, and the burned result has to be the same thing. So every number here is
// derived from the SAME resolver the DOM lane uses (`burnStyleFrom` in ./presets.js), and the
// karaoke behaviour reproduces the harness CSS word-for-word rather than using ASS's own
// progressive-fill karaoke:
//
//     .capw      { color: base;   opacity: .92 }   ← words not yet reached
//     .capw.fut  { opacity: .4 }                   ← ahead of the current word
//     .capw.act  { color: accent; opacity: 1  }    ← the word being spoken
//     .capw.past { opacity: .95 }                  ← already spoken
//
// `{\k}` cannot express "only the current word is accented" — it fills progressively and leaves
// sung words highlighted. One Dialogue line per word window can, and libass handles thousands of
// them without complaint, so that is what this builds.
//
// Two documented differences from the DOM lane, both deliberate:
//   1. Long cues WRAP here; the harness shrinks the font until the line fits. Wrapping reads
//      better than shrinking to dust, and libass has no measure-then-shrink hook.
//   2. `glow` is approximated with a soft outline plus shadow. CSS `text-shadow` blur has no
//      libass equivalent — outline+shadow is the closest honest match.

const CS = (t) => Math.max(0, Math.round(t * 100)); // ASS works in centiseconds

/** `H:MM:SS.CC` — ASS timestamps are single-digit hour, two-digit centiseconds. */
export function assTime(t) {
  const cs = CS(t);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/**
 * CSS `#RRGGBB` → ASS `&HAABBGGRR`.
 *
 * Two reversals in one value and both are easy to get backwards: the byte order is BGR, not RGB,
 * and the alpha channel is TRANSPARENCY — &H00 is fully opaque, &HFF fully invisible. Everything
 * that looked "washed out" or "wrong colour" in a burned subtitle traces back to this function.
 *
 * @param {string} hex `#RGB`, `#RRGGBB`, or an `rgba()` string
 * @param {number} opacity 0..1 (1 = opaque)
 */
export function toAssColor(hex, opacity = 1) {
  let r = 255, g = 255, b = 255, a = opacity;
  const s = String(hex || '').trim();
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgba) {
    r = +rgba[1]; g = +rgba[2]; b = +rgba[3];
    if (rgba[4] != null) a = opacity * parseFloat(rgba[4]);
  } else {
    const h = s.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (/^[0-9a-f]{6}$/i.test(full)) {
      r = parseInt(full.slice(0, 2), 16); g = parseInt(full.slice(2, 4), 16); b = parseInt(full.slice(4, 6), 16);
    }
  }
  const alpha = Math.round((1 - Math.max(0, Math.min(1, a))) * 255);
  const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `&H${hx(alpha)}${hx(b)}${hx(g)}${hx(r)}`;
}

/** Inline alpha override (`\alpha`) — same inverted scale as the alpha byte above. */
function assAlpha(opacity) {
  const a = Math.max(0, Math.min(255, Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)));
  return `&H${a.toString(16).padStart(2, '0').toUpperCase()}&`;
}

/**
 * Neutralise the three things libass reads as markup inside a Dialogue body.
 *
 * `{` and `}` delimit an override block, so an unescaped brace in narration swallows the rest of
 * the line. A backslash is only special in front of `N`, `n` or `h` (hard break, soft break,
 * hard space) — every other `\x` is literal, so dropping the backslash from just those three is
 * the smallest correct fix. Real newlines become the ASS line break.
 */
export function escapeAssText(s) {
  return String(s == null ? '' : s)
    .replace(/\\([Nnh])/g, '$1')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

export function applyTextCase(s, textCase) {
  const t = String(s == null ? '' : s);
  if (textCase === 'uppercase') return t.toUpperCase();
  if (textCase === 'lowercase') return t.toLowerCase();
  if (textCase === 'titlecase') return t.replace(/\p{L}[\p{L}\p{M}']*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return t;
}

// Border geometry per effect, in the PlayRes px space (PlayResX/Y = the real frame size, so
// these are literal pixels). Mirrors the harness `capActFx` branch.
function borderFor(style) {
  const fs = style.fontSizePx;
  switch (style.effect) {
    case 'outline':
      return { borderStyle: 1, outline: Math.max(1, Math.round(fs * 0.045)), shadow: Math.max(1, Math.round(fs * 0.03)) };
    case 'box':
      // BorderStyle 3 paints an opaque box in BackColour behind the line — the ASS spelling of
      // `.capw.act{background:…;padding:…;border-radius:…}`. Rounded corners are not expressible.
      return { borderStyle: 3, outline: Math.max(2, Math.round(fs * 0.10)), shadow: 0 };
    case 'shadow':
      return { borderStyle: 1, outline: Math.max(1, Math.round(fs * 0.02)), shadow: Math.max(2, Math.round(fs * 0.06)) };
    case 'glow':
    default:
      // No blur in libass. A wide soft-dark outline plus an offset shadow reads closest to the
      // CSS glow at video distance; documented as an approximation, not a match.
      return { borderStyle: 1, outline: Math.max(2, Math.round(fs * 0.05)), shadow: Math.max(2, Math.round(fs * 0.05)) };
  }
}

/**
 * Style + script header.
 * PlayResX/Y are set to the real frame so every px in `style` maps 1:1 and nothing has to be
 * rescaled by eye. `YCbCr Matrix: None` stops libass re-converting colours during the blend,
 * which is the usual reason a burned #FFFFFF comes out slightly grey.
 */
function header(style, { w, h }) {
  const b = borderFor(style);
  const marginH = Math.round(w * (style.marginPct ?? 0.06));
  const marginV = Math.round(h * ((style.bottomPct ?? 12) / 100));
  const back = style.effect === 'box'
    ? toAssColor(style.boxBg || 'rgba(10,10,16,0.85)')
    : toAssColor('#000000', 0.85);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    // 0 = smart wrapping with balanced line lengths. The harness shrinks instead of wrapping;
    // see the module header for why this lane wraps.
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,'
      + ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,'
      + ' Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Bold stays 0 on purpose: the requested weight is satisfied by putting the RIGHT font file in
    // the burn's fontsdir (see media/fontdir.js). Asking libass for synthetic bold on top of an
    // already-black face smears it.
    `Style: Cap,${style.font},${style.fontSizePx},${toAssColor(style.color)},${toAssColor(style.baseColor)},`
      + `${toAssColor('#000000', 0.92)},${back},0,0,0,0,100,100,${Math.round(style.fontSizePx * 0.01)},0,`
      + `${b.borderStyle},${b.outline},${b.shadow},2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

function dialogue(start, end, text) {
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`;
}

// One line per word window, each drawing the WHOLE cue with the current word picked out. The
// window runs from this word's start to the next word's start so the caption never blinks out
// during the gaps between words.
function karaokeLines(cue, style) {
  const words = (cue.words || []).filter((wd) => wd && wd.word != null);
  if (!words.length) return [staticLine(cue, style, style.color, 1)];
  const base = toAssColor(style.baseColor);
  const act = toAssColor(style.color);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const from = i === 0 ? Math.min(cue.start, words[0].start) : words[i].start;
    const to = i === words.length - 1 ? Math.max(cue.end, words[i].end) : words[i + 1].start;
    if (to - from < 0.01) continue; // a zero-length window would emit an invisible line
    const parts = words.map((wd, j) => {
      const txt = escapeAssText(applyTextCase(wd.word, style.textCase));
      if (j === i) return `{\\c${act}\\alpha${assAlpha(1)}}${txt}`;
      // .capw.past = .95, .capw (reached, not yet spoken) = .92, .capw.fut = .4
      const op = j < i ? 0.95 : 0.4;
      return `{\\c${base}\\alpha${assAlpha(op)}}${txt}`;
    });
    out.push(dialogue(from, to, parts.join(' ')));
  }
  // every word window collapsed (degenerate timings) — fall back to a single static line
  return out.length ? out : [staticLine(cue, style, style.baseColor, 1)];
}

function staticLine(cue, style, colour, opacity) {
  const text = cue.text != null && cue.text !== ''
    ? cue.text
    : (cue.words || []).map((wd) => wd.word).join(' ');
  const body = escapeAssText(applyTextCase(text, style.textCase));
  return dialogue(cue.start, cue.end, `{\\c${toAssColor(colour)}\\alpha${assAlpha(opacity)}}${body}`);
}

/**
 * @param {Array} cues whole-video cues, already shifted onto the program timeline
 * @param {object} style output of `burnStyleFrom` — never a raw config
 * @param {{w:number,h:number}} size the real output frame
 * @returns {string} a complete .ass document
 */
export function buildAss(cues, style, { w, h }) {
  const lines = [header(style, { w, h })];
  for (const cue of cues || []) {
    if (!cue || !(cue.end > cue.start)) continue;
    if (style.mode === 'plain') lines.push(staticLine(cue, style, style.baseColor, 1));
    else lines.push(...karaokeLines(cue, style));
  }
  return `${lines.join('\n')}\n`;
}
