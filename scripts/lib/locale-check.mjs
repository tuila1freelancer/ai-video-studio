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
 * that reason. The VIDEO-language picker is the opposite: the user is choosing what to produce,
 * and a Japanese interface should offer them ベトナム語, not Tiếng Việt.
 */
export const NO_TRANSLATE = /^$/;

/** Languages written in a script that shares no letters with Vietnamese. */
const NON_LATIN = new Set(['ja', 'ko', 'zh', 'th', 'hi', 'ru']);

/**
 * Any accented Latin letter — the RIGHT class for the leftover check, and deliberately broader
 * than the Vietnamese-only one above.
 *
 * "Màu" carries only à, which Vietnamese shares with French, so the narrow class walked past a
 * Japanese sentence that still began with the Vietnamese word it was meant to replace. Inside a
 * Japanese, Thai or Russian string an accented Latin letter is a leftover almost by definition.
 */
// The two holes are deliberate: U+00D7 × and U+00F7 ÷ sit inside the Latin-1 letter block and are
// MATH SIGNS. Without them "1024×1024 — 正方形" reads as a leftover Vietnamese word in six
// catalogues at once, which is how they were found.
const ACCENTED_LATIN = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF]/;

/**
 * Keys whose value legitimately KEEPS Vietnamese in every language.
 *
 * The voice-search placeholder names two real voices as examples — "HoaiMy, Ngọc Huyền" — and a
 * Japanese user looking for them has to read the names the picker actually shows. Listed one by
 * one rather than loosened into a rule, so the next leftover Vietnamese word is still caught.
 */
const KEEPS_VIETNAMESE = new Set(['ui.voicePickerModal.tim-ten-giong-vd-hoaimy']);

/**
 * Keys where a Latin word surviving into a non-Latin interface is a CHOICE, not a leftover.
 *
 * The video-language picker is the whole list: "Português" is a perfectly good way to write that
 * language's name in a Hindi or Thai interface, and the rule below cannot tell that apart from a
 * word the model forgot to translate.
 */
const LATIN_IS_FINE = /^ui\.(cfgLang|evLang)\./;

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
 * ...and below this, no label is too long, whatever the ratio says.
 *
 * A ratio stops meaning anything at two characters. "Ẩn" is 2, so even 4.5x allows only 9 — and
 * the correct German is "Ausblenden" (10) and the correct Indonesian "Sembunyikan" (11). Both were
 * rejected as layout-breaking by a rule that had never seen a source this short. Nothing breaks a
 * button at fourteen characters, so that is the floor.
 */
const ALWAYS_FINE = 14;

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
    const max = Math.max(ALWAYS_FINE, Math.ceil(src.length * ceiling(src)));
    const cap = src.length <= 8 ? Math.min(max, ABSOLUTE_MAX) : max;
    if (got.length > cap) out.push(`${code} ${key}: ${got.length} chars for a ${src.length}-char label (max ${cap})`);
    // A translation byte-identical to its source is usually a batch that failed silently and
    // echoed its input back — but only when there was something to translate. Plenty of real
    // strings are a filename, a shortcut or an English product word ("⬇ scenes.json · Copy JSON")
    // and come back the same in every language, correctly.
    if (code !== 'vi' && got === src && VIETNAMESE.test(src)) {
      out.push(`${code} ${key}: untranslated (identical to source)`);
    }
    // A PARTLY translated string slips past the test above: a Japanese sentence that begins with
    // the Vietnamese word it was supposed to replace reads as translated until you look. In a
    // language that does not write in Latin at all, a Vietnamese letter can only be a leftover.
    if (NON_LATIN.has(code.replace('.json', '').replace('guide.', '')) && ACCENTED_LATIN.test(got) && !KEEPS_VIETNAMESE.has(key) && !LATIN_IS_FINE.test(key)) {
      out.push(`${code} ${key}: Vietnamese left inside the translation — "${got.slice(0, 30)}"`);
    }
  }
  for (const key of Object.keys(target)) {
    if (!(key in source)) out.push(`${code} ${key}: stale — no longer in the source catalogue`);
  }
  return out;
}
