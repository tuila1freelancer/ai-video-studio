// ASS colour and alpha primitives.
//
// Their own module because both the text builder (./ass.js) and the drawn background (./box.js)
// need them, and having box.js reach back into ass.js would make the pair circular — which works
// in ESM only by accident of hoisting, and stops working the moment one of them does something at
// module scope.

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

/** Inline alpha override value (`\alpha`, `\1a`, `\3a`) — same inverted scale as the byte above. */
export function assAlpha(opacity) {
  const a = Math.max(0, Math.min(255, Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)));
  return `&H${a.toString(16).padStart(2, '0').toUpperCase()}&`;
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
