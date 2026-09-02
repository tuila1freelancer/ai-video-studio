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

/** Language of a single piece of text, by script/diacritics. Cheap, no I/O, no model. */
export function detectLang(text) {
  const s = String(text || '');
  if (/[ạảãàáâậầấẩẫăắằẳẵặẹẻẽèéêệềếểễịỉĩìíọỏõòóôộồốổỗơớờởỡợụủũùúưứừửữựỳýỵỷỹđ]/i.test(s)) return 'vi';
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[가-힯]/.test(s)) return 'ko';
  if (/[一-鿿]/.test(s)) return 'zh';
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  return 'en';
}

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
