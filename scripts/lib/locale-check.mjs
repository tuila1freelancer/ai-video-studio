// What a machine can prove about a translation without reading the language.
//
// Shared by the build script and by the test, so a catalogue cannot pass one and fail the other.
const PLACEHOLDER = /\{(\w+)\}/g;
const MARKERS = [/\*\*/g, /`/g];

/** Length ceiling as a multiple of the source. Long strings compress; short labels do not. */
function ceiling(src) {
  if (src.length <= 12) return 2.6;   // "Lưu" → "Speichern" is already 3x
  if (src.length <= 30) return 1.9;
  return 1.5;
}

/**
 * @returns {string[]} one readable line per problem — empty when the catalogue is sound.
 */
export function checkCatalogue(source, target, code) {
  const out = [];
  for (const [key, src] of Object.entries(source)) {
    const got = target[key];
    if (got === undefined) { out.push(`${code} ${key}: MISSING`); continue; }
    if (typeof got !== 'string' || !got.trim()) { out.push(`${code} ${key}: empty`); continue; }

    const want = [...String(src).matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
    const have = [...got.matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
    if (want.join() !== have.join()) out.push(`${code} ${key}: placeholders ${want.join(' ') || '(none)'} → ${have.join(' ') || '(none)'}`);

    for (const marker of MARKERS) {
      const a = (String(src).match(marker) || []).length;
      const b = (got.match(marker) || []).length;
      if (a !== b) out.push(`${code} ${key}: markdown marker count ${a} → ${b}`);
    }
    const max = Math.ceil(src.length * ceiling(src));
    if (got.length > max) out.push(`${code} ${key}: ${got.length} chars for a ${src.length}-char label (max ${max})`);
    // A translation that is byte-identical to a long Vietnamese source is a batch that failed
    // silently and echoed its input back.
    if (code !== 'vi' && src.length > 25 && got === src) out.push(`${code} ${key}: untranslated (identical to source)`);
  }
  for (const key of Object.keys(target)) {
    if (!(key in source)) out.push(`${code} ${key}: stale — no longer in the source catalogue`);
  }
  return out;
}
