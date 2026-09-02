// THE language module. Two jobs, kept in one file that imports nothing but the language table so
// every layer — the TTS façade, the script engine, the codegen prompt, the render validator, the
// HTTP routes — can agree on the answer without pulling in anything heavier.
//
// 1. detectLang(text)           — what language is THIS text?
// 2. resolveLang(config, texts) — what language is THIS VIDEO?
//
// (2) exists because the app used to have no answer to it. `config.language` was read in 21 places
// and written by nothing in the create-video UI, so every layer invented its own fallback and they
// disagreed: the script engine auto-detected from the topic (right), the scorer took the majority
// across scenes (right), while the editorial rewrite, the art-direction brief, the budget and the
// thumbnail all hardcoded 'vi' (wrong). On an English video that mismatch rewrote narration INTO
// Vietnamese and told the codegen model the narration WAS Vietnamese. One resolver, one answer.

import { LANGUAGES, DEFAULT_LANG, lang as langRow, column } from '../i18n/languages.js';

export { DEFAULT_LANG, LANGUAGES };

// Function words that only ONE of the Latin-script languages uses. Not a language model: a
// handful of tokens a real paragraph in that language cannot avoid.
//
// Discriminative, not merely frequent — that distinction is the whole design. A first pass put
// "que" in the French, Spanish and Portuguese sets and "la" in two of them, so a Spanish
// sentence scored 4 for Spanish and 3 for French and the two cancelled out. Every token below
// belongs to exactly one language: "es"/"é", "no"/"não", "mucho"/"muito", "cuando"/"quando".
const LATIN_MARKERS = {
  en: "the and of to is that for with you this are was have from at be on not but they how what",
  fr: "le les des du et est une qui pour dans vous avec sur nous votre ce sont cette tout aussi",
  de: "der die das und ist den dem ein eine nicht mit für sich auf von auch aber wird war hat kann nur mehr wie noch",
  es: "el los las es más pero muy este esta cuando sus están hacer todo sin mucho hay porque nadie ahora",
  pt: "os um uma não você isso muito quando seus estão então fazer tudo mas ele ela está é com mais tem já só até aqui agora gente coisa pode",
  id: "yang dan di ini itu dengan untuk tidak adalah dari ke akan bisa kita juga pada atau saya lebih sangat",
};
const MARKER_SETS = Object.entries(LATIN_MARKERS).map(([code, words]) => [code, new Set(words.split(' '))]);

/**
 * What language is this text, and can we tell?
 *
 * `confident` is the half that matters. The old detector answered 'en' for every unaccented
 * Latin script and said nothing about how sure it was, so the render validator compared a
 * French headline against 'fr', got 'en', and re-asked the model for a scene that was already
 * correct — up to LANG_REASK_MAX times, on every scene of every French, German, Spanish,
 * Portuguese and Indonesian video.
 *
 * A script with its own codepoints is decided outright. Latin text is scored on function words,
 * and a thin or evenly-split sample is honestly reported as a guess.
 * @returns {{code: string, confident: boolean}}
 */
export function classifyLang(text) {
  const s = String(text || '');
  // Scripts that identify themselves. Vietnamese first: it is written in Latin letters, so its
  // tone marks have to be tested before the generic Latin path can claim it.
  //
  // ONLY letters Vietnamese does not share. The shipped class also held à á â è é ê ì í ò ó ô
  // ù ú ý ã õ — every one of which French, Spanish, Portuguese and Italian use constantly — so
  // any accented sentence in those languages was answered 'vi'. On `language: auto` that meant
  // a Spanish topic came back written, voiced and captioned in Vietnamese. What is left is the
  // dot-below, the hook-above, the tone-marked â/ê/ô/ơ/ư forms, and ă ơ ư đ.
  if (/[ạảầấẩẫậắằẳẵặẹẻẽệềếểễịỉĩọỏộồốổỗớờởỡợụủũứừửữựỳỵỷỹăơưđ]/i.test(s.normalize('NFC'))) return { code: 'vi', confident: true };
  if (/[぀-ヿ]/.test(s)) return { code: 'ja', confident: true };
  if (/[가-힯]/.test(s)) return { code: 'ko', confident: true };
  if (/[一-鿿]/.test(s)) return { code: 'zh', confident: true };
  if (/[Ѐ-ӿ]/.test(s)) return { code: 'ru', confident: true };
  if (/[฀-๿]/.test(s)) return { code: 'th', confident: true };
  if (/[ऀ-ॿ]/.test(s)) return { code: 'hi', confident: true };

  const tokens = (s.toLowerCase().match(/[a-zà-ÿ']+/g) || []);
  // Below this a sample carries no signal at all — a two-word headline is not evidence of
  // anything, and treating it as evidence is exactly what produced the false leaks.
  if (tokens.length < 6) return { code: 'en', confident: false };

  const scores = MARKER_SETS.map(([code, set]) => [code, tokens.filter((t) => set.has(t)).length]);
  scores.sort((a, b) => b[1] - a[1]);
  const [best, runnerUp] = scores;
  // A winner has to be both PRESENT and AHEAD: enough hits to be more than coincidence, and
  // clearly past the second guess. Otherwise we report the best guess and admit it is one.
  const confident = best[1] >= 3 && best[1] >= runnerUp[1] * 1.5;
  return { code: confident ? best[0] : 'en', confident };
}

/** Language of a single piece of text, by script/function words. Cheap, no I/O, no model. */
export function detectLang(text) { return classifyLang(text).code; }

/** Display names — used in prompts, so a model is told "English (US)", never the code "en". */
export const LANG_NAME = column('name');

/** Human name for a language code — for prompts and owner-facing messages. */
export function langName(code) { return LANG_NAME[code] || code || langRow(DEFAULT_LANG).name; }

/**
 * The name as an ADJECTIVE, for prose that reads "a ${L} word" / "complete ${L} words".
 * LANG_NAME carries a disambiguating parenthetical ("English (US)", "Spanish (neutral/Latin
 * American)") that is right for "write the narration in X" and wrong inside a noun phrase.
 */
export function langAdjective(code) { return langName(code).replace(/\s*\(.*\)$/, ''); }

/** The trailing breath pad after a scene's voice, in ms. One table row, not five ternaries. */
export function padMsFor(code) { return langRow(code).padMs; }

/**
 * The language the OWNER declared for this video, or null if they did not.
 *
 * '' and 'auto' both mean "not declared" — and 'auto' is a value that genuinely reaches the DB
 * (createEditVideoProject writes it), so treating it as a language would be a real bug, not a
 * hypothetical one.
 * @returns {string|null} a lowercase code, or null
 */
export function declaredLang(config) {
  const raw = String(config?.language || '').trim().toLowerCase();
  return raw && raw !== 'auto' ? raw : null;
}

/**
 * The language actually spoken by a set of lines — the MAJORITY, not the first one.
 *
 * Only lines of ≥4 words vote (mirroring the scorer's own floor): a scene stub, a one-word title
 * card or an unwritten line detects as 'en' by default and would otherwise drag the whole video.
 * @returns {string|null} null when nothing is substantial enough to vote
 */
export function majorityLang(texts = []) {
  const votes = new Map();
  for (const t of texts || []) {
    const s = String(t || '').trim();
    if (!s || (s.match(/\S+/g) || []).length < 4) continue;
    const l = detectLang(s);
    votes.set(l, (votes.get(l) || 0) + 1);
  }
  if (!votes.size) return null;
  // A tie keeps the language seen first at that count — deterministic either way.
  return [...votes.entries()].reduce((best, e) => (e[1] > best[1] ? e : best))[0];
}

/**
 * THE answer to "what language is this video". Declaration beats content; content beats the house
 * default. Pass the scene narration lines whenever the caller has them — a stage that cannot see
 * the scenes still gets the declared value, which is the case that matters.
 * @param {object} config  the project config
 * @param {(string|{voice_text?:string})[]} texts  narration lines, or scene rows
 * @returns {string} always a real language code, never 'auto'
 */
export function resolveLang(config, texts = []) {
  const declared = declaredLang(config);
  if (declared) return declared;
  const lines = (texts || []).map((t) => (typeof t === 'string' ? t : t?.voice_text));
  return majorityLang(lines) || DEFAULT_LANG;
}
