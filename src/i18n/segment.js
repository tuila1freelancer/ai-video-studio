// Where one word ends and the next begins — a question with a different answer per language.
//
// Chinese, Japanese and Thai are written with no spaces between words. Every whitespace count in
// this codebase therefore returned 1 for a whole paragraph of them, and the consequences were not
// cosmetic: a 5,000-character Chinese script counted as ~1 word, fell under SCRIPT_MODE_MIN_WORDS,
// was routed to "topic" mode and the user's script was discarded and rewritten. The same
// collapse silently broke the near-duplicate check, the polish floor, sentence-mode subtitles and
// the beat extraction that drives the whole on-screen choreography.
//
// Intl.Segmenter is the answer and it costs nothing: the vendored Node is built with full ICU and
// so is the headless Chrome the harness runs in. A small-icu runtime would return one segment for
// the whole string, which is why tests/i18n-contract.test.js checks a real Chinese and Thai split.
import { lang } from './languages.js';

// Segmenters are expensive to construct and pure once built.
const wordSegs = new Map();
const sentSegs = new Map();
const segmenter = (cache, locale, granularity) => {
  let s = cache.get(locale);
  if (!s) { s = new Intl.Segmenter(locale, { granularity }); cache.set(locale, s); }
  return s;
};

/**
 * The words of a text, the way this language counts them.
 *
 * Space-separated languages keep the letter/digit-run definition every call site already used,
 * so Vietnamese and the Latin set count exactly as they always have.
 * @returns {string[]}
 */
export function words(text, code) {
  const s = String(text || '');
  if (!s) return [];
  const row = lang(code);
  if (row.wordMode !== 'intl') return s.match(/[\p{L}\p{N}]+/gu) || [];
  return [...segmenter(wordSegs, row.numberLocale, 'word').segment(s)]
    .filter((seg) => seg.isWordLike).map((seg) => seg.segment);
}

/** How many words this language sees in the text. */
export function countWords(text, code) { return words(text, code).length; }

/**
 * The sentences of a text.
 *
 * Thai writes without sentence-final punctuation at all, so no regex can find its boundaries;
 * CJK ends sentences on 。！？ rather than .!?. Both come from ICU. Everything else keeps the
 * punctuation split it already had, down to the same character class.
 * @returns {string[]}
 */
export function sentences(text, code) {
  const s = String(text || '').replace(/\s+/g, ' ');
  if (!s.trim()) return [];
  if (lang(code).sentenceMode === 'intl') {
    return [...segmenter(sentSegs, lang(code).numberLocale, 'sentence').segment(s)]
      .map((seg) => seg.segment.trim()).filter((x) => x.length > 1);
  }
  return s.split(/(?<=[.!?…。])\s+|(?<=[।。！？])/).map((x) => x.trim()).filter((x) => x.length > 1);
}

/**
 * How much horizontal room a string asks for, in units of one Latin character.
 *
 * A caption budget of "42 characters" means two different things in English and in Chinese: a CJK
 * glyph is drawn full-width, so 42 of them need twice the line. Counted rather than measured —
 * the callers that need real pixels already measure in the browser.
 */
export function visualWidth(text) {
  let w = 0;
  for (const ch of String(text || '')) {
    // CJK ideographs, kana, Hangul syllables and full-width forms all occupy two columns.
    w += /[ᄀ-ᅟ⺀-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return w;
}

/** What to put between two words when re-joining them — nothing, in a language without spaces. */
export function wordJoiner(code) { return lang(code).wordMode === 'intl' ? '' : ' '; }

/**
 * The pieces a caption line may be broken between — LOSSLESS.
 *
 * `words()` drops punctuation, which is right for counting and wrong for drawing: rejoining its
 * output would silently delete every 。 and ？ from a Chinese caption. Here a non-word segment is
 * glued to the token before it, so `tokens.join(wordJoiner(code))` reproduces the input exactly.
 * The caption measurer and the ASS writer must both use this, or their break indices refer to
 * different tokens and the box fits a line the burn never draws.
 */
export function layoutTokens(text, code) {
  const s = String(text || '');
  if (!s) return [];
  if (lang(code).wordMode !== 'intl') return s.split(' ');
  const out = [];
  for (const seg of segmenter(wordSegs, lang(code).numberLocale, 'word').segment(s)) {
    if (seg.isWordLike || !out.length) out.push(seg.segment);
    else out[out.length - 1] += seg.segment;
  }
  return out;
}
