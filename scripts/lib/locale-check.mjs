// What a machine can prove about a translation without reading the language.
//
// Shared by the build script and by the test, so a catalogue cannot pass one and fail the other.
const PLACEHOLDER = /\{(\w+)\}/g;
const MARKERS = [/\*\*/g, /`/g];
// Letters Vietnamese does NOT share, exactly as src/util/lang.js had to learn: à á â è é ê ì í ò
// ó ô ù ú ã õ belong to French, Spanish and Portuguese too, so "Português" would read as
// Vietnamese and be reported as an untranslated string in nine catalogues.
const VIETNAMESE = /[ạảầấẩẫậắằẳẵặẹẻẽệềếểễịỉĩọỏộồốổỗớờởỡợụủũứừửữựỳỵỷỹăơưđ]/i;

/**
 * Keys whose value is the same in every language by design. Empty on purpose.
 *
 * The first version of this excluded the video-language picker, on the theory that a language is
 * listed by its own name. That is right for the INTERFACE picker — where someone who cannot read
 * the current language has to find their own — and it is built from hardcoded endonyms for exactly
 * that reason. The VIDEO-language picker is the opposite: the owner is choosing what to produce,
 * and a Japanese interface should offer them ベトナム語, not Tiếng Việt.
 */
export const NO_TRANSLATE = /^$/;

/**
 * Length ceiling, calibrated against nine real machine-translated catalogues rather than guessed.
 *
 * Vietnamese is a compact language and a short label cannot constrain a long one: "Tạo" is three
 * characters and "Erstellen" is nine, which is correct German and a 3x ratio. Measured maxima
 * across en/ja/ko/zh/ru/fr/de/es/pt were 4.0x at ≤8 chars, 2.55x at ≤20, 1.83x at ≤45 and 1.62x
 * beyond — so the ceilings sit just above each, and a short label also gets an ABSOLUTE cap,
 * because a button 40 characters wide is a broken layout whatever its source said.
 */
function ceiling(src) {
  if (src.length <= 8) return 4.5;
  if (src.length <= 20) return 2.8;
  if (src.length <= 45) return 2.0;
  return 1.8;
}

/** Past this a UI label is not a label any more, whatever its source length allowed. */
const ABSOLUTE_MAX = 40;

/**
 * @returns {string[]} one readable line per problem — empty when the catalogue is sound.
 */
export function checkCatalogue(source, target, code) {
  const out = [];
  for (const [key, src] of Object.entries(source)) {
    if (NO_TRANSLATE.test(key)) continue;   // an endonym is correct unchanged
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
    const cap = src.length <= 8 ? Math.min(max, ABSOLUTE_MAX) : max;
    if (got.length > cap) out.push(`${code} ${key}: ${got.length} chars for a ${src.length}-char label (max ${cap})`);
    // A translation byte-identical to its source is usually a batch that failed silently and
    // echoed its input back — but only when there was something to translate. Plenty of real
    // strings are a filename, a shortcut or an English product word ("⬇ scenes.json · Copy JSON")
    // and come back the same in every language, correctly.
    if (code !== 'vi' && got === src && VIETNAMESE.test(src)) {
      out.push(`${code} ${key}: untranslated (identical to source)`);
    }
  }
  for (const key of Object.keys(target)) {
    if (!(key in source)) out.push(`${code} ${key}: stale — no longer in the source catalogue`);
  }
  return out;
}
