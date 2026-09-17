// The two bits of SSML every speech provider that accepts SSML needs, in one place.
//
// A stray & or < in a narration line turns a whole request into a parse error, and it is exactly
// the kind of thing a script about "R&D" or "5 < 10" produces without anyone noticing.
export function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const prosodyValue = (v, lo, hi) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n !== 0 ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Wrap text in `<prosody>` when the owner asked for a rate or pitch change, else return it bare. */
export function ssmlProsody(inner, cfg = {}) {
  const rate = prosodyValue(cfg.rate, -50, 100);
  const pitch = prosodyValue(cfg.pitch, -24, 24);
  if (rate == null && pitch == null) return inner;
  const attrs = [
    rate != null ? `rate="${rate > 0 ? '+' : ''}${rate}%"` : '',
    pitch != null ? `pitch="${pitch > 0 ? '+' : ''}${pitch}st"` : '',
  ].filter(Boolean).join(' ');
  return `<prosody ${attrs}>${inner}</prosody>`;
}
