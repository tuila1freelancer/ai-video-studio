// Subtitle re-chunking (P29) — presentation-layer only. The stored srt_json stays the
// canonical word-timed truth (beats, QC and re-renders keep reading it); this module
// rebuilds the DISPLAY cues from those exact word timestamps, so every produced cue
// starts on its first word's real start and ends on its last word's real end — the
// "subtitles match the voice" guarantee is inherited, never re-estimated.
//
// Modes:
//   auto     — the engine's natural phrase cues (5–7 words), unchanged pass-through
//   sentence — one cue per sentence of the narration text (word counts walked in order)
//   words    — fixed N timed words per cue (orphan-merge so no single-word flash)

import { countWords, sentences as segmentSentences, wordJoiner } from '../i18n/segment.js';
import { lang as langRow } from '../i18n/languages.js';

const STRONG_PUNCT = /[.!?…;:]["'”’)\]]?$/; // mirrors media/whisper.js grouping boundary
const SENT_SPLIT = /[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g;
const CJK_PUNCT = /[。！？；]$/; // the same boundary, in the punctuation CJK actually uses

const finish = (words, lang) => ({
  start: words[0].start, end: words[words.length - 1].end,
  text: words.map((w) => w.word).join(wordJoiner(lang)), words,
});

/**
 * Split narration into sentences (keeps trailing punctuation).
 *
 * SENT_SPLIT knows only .!?… — Japanese and Chinese end sentences on 。！？ and Thai marks no
 * sentence end at all, so both came back as ONE cue holding the whole scene. Given a language,
 * ICU answers instead.
 */
export function splitSentences(text, lang) {
  if (lang && langRow(lang).sentenceMode === 'intl') return segmentSentences(text, lang);
  return (String(text || '').match(SENT_SPLIT) || []).map((s) => s.trim()).filter(Boolean);
}

function flatten(cues) {
  const out = [];
  for (const c of cues || []) for (const w of c.words || []) out.push(w);
  return out;
}

function chunkByWords(words, n, lang) {
  const per = Math.max(2, Math.min(12, parseInt(n, 10) || 4));
  const cues = [];
  for (let i = 0; i < words.length; i += per) cues.push(finish(words.slice(i, i + per), lang));
  // orphan merge: a lone trailing word joins the previous cue instead of flashing alone
  if (cues.length >= 2 && cues[cues.length - 1].words.length === 1) {
    const last = cues.pop();
    cues[cues.length - 1] = finish([...cues[cues.length - 1].words, ...last.words], lang);
  }
  return cues;
}

function chunkBySentence(words, text, lang) {
  const sentences = splitSentences(text, lang);
  if (!sentences.length) return chunkByPunct(words, lang);
  const cues = [];
  let i = 0;
  for (let s = 0; s < sentences.length && i < words.length; s++) {
    // the last sentence absorbs any surplus words (count drift between text and timing)
    const want = s === sentences.length - 1 ? words.length - i : countWords(sentences[s], lang);
    if (want <= 0) continue;
    const grp = words.slice(i, Math.min(words.length, i + want));
    if (grp.length) cues.push(finish(grp, lang));
    i += grp.length;
  }
  if (i < words.length) cues.push(finish(words.slice(i), lang));
  return cues;
}

// sentence fallback when no narration text is available: break on spoken punctuation
function chunkByPunct(words, lang) {
  const cues = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (STRONG_PUNCT.test(w.word) || CJK_PUNCT.test(w.word)) { cues.push(finish(cur, lang)); cur = []; }
  }
  if (cur.length) cues.push(finish(cur, lang));
  return cues.length ? cues : (words.length ? [finish(words, lang)] : []);
}

/**
 * @param {Array} cues canonical srt_json cues [{start,end,text,words:[{word,start,end}]}]
 * @param {{chunk?:'auto'|'sentence'|'words', wordsPerCue?:number, text?:string, lang?:string}} opts
 * @returns display cues in the same shape (auto returns the input array untouched)
 */
export function rechunkCues(cues, { chunk = 'auto', wordsPerCue = 4, text = '', lang } = {}) {
  const list = Array.isArray(cues) ? cues : [];
  if (chunk !== 'sentence' && chunk !== 'words') return list;
  const words = flatten(list);
  if (!words.length) return list; // estimate-era cues without word arrays — nothing to rebuild from
  return chunk === 'words' ? chunkByWords(words, wordsPerCue, lang) : chunkBySentence(words, text, lang);
}
