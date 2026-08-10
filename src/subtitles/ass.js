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
 * The alpha tag to dim one word with.
 *
 * `\alpha` is a shorthand that sets all four alpha channels at once, including the OUTLINE alpha —
 * and under BorderStyle 3 the outline is the box. So dimming an unspoken word also faded the box
 * behind it, giving a boxed caption a patchwork of opacities that tracked the karaoke. The fill
 * alone should follow the word, so a box dims only the text sitting in it.
 *
 * This does not make a translucent BorderStyle 3 box seamless, and nothing here can: libass draws
 * a SEPARATE box per override run, the boxes overlap by their outline width, and a translucent
 * overlap composites twice — a visible seam at every word boundary. Karaoke cannot avoid per-word
 * overrides, so the box has to stop being a border. That is what the drawn box (./box.js) is for.
 */
function wordAlpha(style, opacity) {
  const boxed = style.effect === 'box' || style.karaokeStyle === 'box';
  return `\\${boxed ? '1a' : 'alpha'}${assAlpha(opacity)}`;
}

/**
 * Black or white, whichever is legible on `hex`.
 *
 * The per-word highlight box is painted in the accent the owner already chose, so the text sitting
 * in it needs a colour that contrasts — and asking for one more colour to keep in sync with the
 * accent is a setting that will be wrong more often than right.
 */
export function readableOn(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.36 ? '#000000' : '#FFFFFF';
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
  // Sentence case is applied per CUE, and a karaoke cue arrives one word at a time — so a word in
  // the middle of a sentence has no sentence start in it and is simply lowercased. That is the
  // correct result: the capital belongs to whichever word actually opens the sentence.
  if (textCase === 'sentence') {
    return t.toLowerCase().replace(/(^\s*|[.!?…]\s+)(\p{L})/gu, (_, lead, ch) => lead + ch.toUpperCase());
  }
  return t;
}

// Border geometry per effect, in the PlayRes px space (PlayResX/Y = the real frame size, so
// these are literal pixels). Mirrors the harness `capActFx` branch.
function borderFor(style) {
  const fs = style.fontSizePx;
  const derived = () => {
    switch (style.effect) {
      case 'outline':
        return { borderStyle: 1, outline: Math.max(1, Math.round(fs * 0.045)), shadow: Math.max(1, Math.round(fs * 0.03)) };
      case 'box':
        // BorderStyle 3 paints an opaque box behind the line — the ASS spelling of
        // `.capw.act{background:…;padding:…}`. Rounded corners are not expressible, and a
        // translucent one seams at every override run; ./box.js draws a real shape instead.
        return { borderStyle: 3, outline: Math.max(2, Math.round(fs * 0.10)), shadow: 0 };
      case 'shadow':
        return { borderStyle: 1, outline: Math.max(1, Math.round(fs * 0.02)), shadow: Math.max(2, Math.round(fs * 0.06)) };
      case 'glow':
      default:
        // libass has no blur in the STYLE, but `\blur` is a real override tag — a soft halo line
        // is emitted separately (glowLine) when the owner asks for one. The style itself keeps the
        // wide-outline approximation so an unset config renders exactly as it always has.
        return { borderStyle: 1, outline: Math.max(2, Math.round(fs * 0.05)), shadow: Math.max(2, Math.round(fs * 0.05)) };
    }
  };
  const d = derived();
  // A drawn box takes the background over entirely, so the border reverts to a plain outline —
  // otherwise BorderStyle 3 would paint a second, square, unpadded box on top of the drawn one.
  // A per-word highlight box needs BorderStyle 3, because that is the only per-run background ASS
  // has; the OutlineColour is then made invisible so only the spoken word carries one.
  const borderStyle = style.box ? 1 : (style.karaokeStyle === 'box' ? 3 : d.borderStyle);
  const padding = borderStyle === 3 && d.borderStyle !== 3 ? Math.max(2, Math.round(fs * 0.10)) : d.outline;
  return {
    borderStyle,
    outline: style.outlineWidth ?? (style.box ? Math.max(1, Math.round(fs * 0.02)) : padding),
    shadow: style.shadowDepth ?? (style.box || borderStyle === 3 ? 0 : d.shadow),
  };
}

/**
 * Style + script header.
 * PlayResX/Y are set to the real frame so every px in `style` maps 1:1 and nothing has to be
 * rescaled by eye. `YCbCr Matrix: None` stops libass re-converting colours during the blend,
 * which is the usual reason a burned #FFFFFF comes out slightly grey.
 */
function header(style, { w, h }) {
  const b = borderFor(style);
  const marginH = Math.round(w * ((style.marginHPct != null ? style.marginHPct / 100 : style.marginPct) ?? 0.06));
  const marginV = Math.round(h * ((style.marginVPct ?? style.bottomPct ?? 12) / 100));
  // BorderStyle 3 paints its opaque box in OUTLINE colour — measured against a real libass render,
  // where a box with OutlineColour=red and BackColour=blue comes out red. This was inverted: the
  // box colour went to BackColour (which is the SHADOW colour in both border styles) while the
  // outline stayed hardcoded black, so every "box" preset rendered black no matter what it declared.
  // A per-word highlight box borrows BorderStyle 3 but must not paint the whole line: the style's
  // own box colour is made invisible, and only the spoken word overrides it back (see activeTag).
  const wordBoxOnly = style.karaokeStyle === 'box' && style.effect !== 'box';
  const outline = style.outlineColor ? toAssColor(style.outlineColor)
    : wordBoxOnly ? toAssColor('#000000', 0)
      : b.borderStyle === 3 ? toAssColor(style.boxBg || 'rgba(10,10,16,0.85)')
        : toAssColor('#000000', 0.92);
  const back = style.shadowColor ? toAssColor(style.shadowColor) : toAssColor('#000000', 0.85);
  const bool = (v) => (v ? 1 : 0);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    // 0 = smart wrapping with balanced line lengths. The harness shrinks instead of wrapping;
    // see the module header for why this lane wraps. A drawn box forces 2 (never wrap): the box is
    // sized from a measurement of one line, so libass must not silently reflow into a second.
    `WrapStyle: ${style.box ? 2 : (style.wrap ?? 0)}`,
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,'
      + ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,'
      + ' Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Bold stays 0 on purpose: the requested weight is satisfied by putting the RIGHT font file in
    // the burn's fontsdir (see fonts/files.js). Asking libass for synthetic bold on top of an
    // already-black face smears it.
    `Style: Cap,${style.font},${style.fontSizePx},${toAssColor(style.color)},${toAssColor(style.baseColor)},`
      + `${outline},${back},0,${bool(style.italic)},${bool(style.underline)},${bool(style.strike)},`
      + `${style.scaleX ?? 100},${style.scaleY ?? 100},`
      + `${style.letterSpacing ?? Math.round(style.fontSizePx * 0.01)},${style.angle ?? 0},`
      + `${b.borderStyle},${b.outline},${b.shadow},${style.alignH ?? 2},${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

function dialogue(start, end, text, layer = 0) {
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`;
}

/** `\fad(in,out)` in milliseconds, or '' when neither was asked for. */
function fadeTag(style) {
  const i = Math.max(0, Math.round(style.fadeIn || 0));
  const o = Math.max(0, Math.round(style.fadeOut || 0));
  return i || o ? `\\fad(${i},${o})` : '';
}

/**
 * A soft coloured halo behind the text — the honest version of `glow`.
 *
 * The style itself cannot blur: `Outline`/`Shadow` are hard-edged, which is why the glow effect
 * has always been a documented approximation. `\blur` IS supported as an override tag, so the
 * halo is a second Dialogue on the layer below carrying the same text with a wide, blurred,
 * coloured border and an invisible fill. Verified on a real render, not inferred.
 */
function glowLine(start, end, body, style) {
  const colour = toAssColor(style.glowColor || style.color);
  return dialogue(start, end,
    `{${fadeTag(style)}\\bord${Math.round(style.glow * 1.3)}\\shad0\\blur${style.glow}`
    + `\\3c${colour}\\4a&HFF&\\1a&HFF&}${body}`, 0);
}

/**
 * One word as the halo sees it: no fill, no shadow, and a rim that fades with the word itself.
 *
 * The halo cannot just repeat the plain text — it carries its own alpha, so a word the karaoke has
 * dimmed (or, under progressive reveal, has not shown at all) would still glow at full strength
 * and give away the line before it is spoken.
 */
const haloWord = (txt, opacity) => `{\\r\\1a&HFF&\\4a&HFF&\\3a${assAlpha(opacity)}}${txt}`;

// One line per word window, each drawing the WHOLE cue with the current word picked out. The
// window runs from this word's start to the next word's start so the caption never blinks out
// during the gaps between words.
function karaokeLines(cue, style) {
  const words = (cue.words || []).filter((wd) => wd && wd.word != null);
  if (!words.length) return staticLine(cue, style, style.color, 1);
  const base = toAssColor(style.baseColor);
  const act = toAssColor(style.color);
  const fade = fadeTag(style);
  // `.capw.past = .95, .capw.fut = .4` — the harness CSS, now the owner's to move. Progressive
  // reveal is the same dial taken to its end: an unspoken word at zero opacity has not appeared.
  const dimRead = style.dimRead ?? 0.95;
  const dimUnread = style.reveal ? 0 : (style.dimUnread ?? 0.4);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const from = i === 0 ? Math.min(cue.start, words[0].start) : words[i].start;
    const to = i === words.length - 1 ? Math.max(cue.end, words[i].end) : words[i + 1].start;
    if (to - from < 0.01) continue; // a zero-length window would emit an invisible line
    const shown = words.map((wd, j) => ({
      txt: escapeAssText(applyTextCase(wd.word, style.textCase)),
      op: j === i ? 1 : (j < i ? dimRead : dimUnread),
      active: j === i,
    }));
    const body = shown.map(({ txt, op, active }) => (active
      ? `{\\c${act}${wordAlpha(style, 1)}${activeTag(style)}}${txt}`
      // `\r` resets the run back to the style, undoing a pop's scale for every other word
      : `{\\r\\c${base}${wordAlpha(style, op)}}${txt}`)).join(' ');
    if (style.glow) out.push(glowLine(from, to, shown.map(({ txt, op }) => haloWord(txt, op)).join(' '), style));
    out.push(dialogue(from, to, `{${fade}}${body}`, style.glow ? 1 : 0));
  }
  // every word window collapsed (degenerate timings) — fall back to a single static line
  return out.length ? out : staticLine(cue, style, style.baseColor, 1);
}

/**
 * What marks the word being spoken, beyond its colour.
 *
 * `pop` is off by default and says so in the panel: ASS has no way to scale a glyph in place, so
 * enlarging the active word widens its advance and shoves the rest of the line sideways — a real,
 * visible jitter on every word, confirmed on a rendered frame. `box` needs no measurement because
 * BorderStyle 3 already draws per run; the drawn box handles the rounded version.
 */
function activeTag(style) {
  if (style.karaokeStyle === 'pop') {
    const s = Math.round(style.popScale || 112);
    return `\\fscx${s}\\fscy${s}`;
  }
  if (style.karaokeStyle === 'box') {
    return `\\3a&H00&\\3c${toAssColor(style.color)}\\1c${toAssColor(readableOn(style.color))}`;
  }
  return '';
}

function staticLine(cue, style, colour, opacity) {
  const text = cue.text != null && cue.text !== ''
    ? cue.text
    : (cue.words || []).map((wd) => wd.word).join(' ');
  const body = escapeAssText(applyTextCase(text, style.textCase));
  const lines = [];
  if (style.glow) lines.push(glowLine(cue.start, cue.end, haloWord(body, opacity), style));
  lines.push(dialogue(cue.start, cue.end,
    `{${fadeTag(style)}\\c${toAssColor(colour)}${wordAlpha(style, opacity)}}${body}`, style.glow ? 1 : 0));
  return lines;
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
    if (style.mode === 'plain') lines.push(...staticLine(cue, style, style.baseColor, 1));
    else lines.push(...karaokeLines(cue, style));
  }
  return `${lines.join('\n')}\n`;
}
