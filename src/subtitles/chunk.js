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

const STRONG_PUNCT = /[.!?…;:]["'”’)\]]?$/; // mirrors media/whisper.js grouping boundary
const SENT_SPLIT = /[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g;
const countTokens = (s) => (String(s || '').match(/[\p{L}\p{N}]+/gu) || []).length;

const finish = (words) => ({
  start: words[0].start, end: words[words.length - 1].end,
  text: words.map((w) => w.word).join(' '), words,
});

/** Split narration into sentences (keeps trailing punctuation). */
export function splitSentences(text) {
  return (String(text || '').match(SENT_SPLIT) || []).map((s) => s.trim()).filter(Boolean);
}

function flatten(cues) {
  const out = [];
  for (const c of cues || []) for (const w of c.words || []) out.push(w);
  return out;
}

function chunkByWords(words, n) {
  const per = Math.max(2, Math.min(12, parseInt(n, 10) || 4));
  const cues = [];
  for (let i = 0; i < words.length; i += per) cues.push(finish(words.slice(i, i + per)));
  // orphan merge: a lone trailing word joins the previous cue instead of flashing alone
  if (cues.length >= 2 && cues[cues.length - 1].words.length === 1) {
    const last = cues.pop();
    cues[cues.length - 1] = finish([...cues[cues.length - 1].words, ...last.words]);
  }
  return cues;
}

function chunkBySentence(words, text) {
  const sentences = splitSentences(text);
  if (!sentences.length) return chunkByPunct(words);
  const cues = [];
  let i = 0;
  for (let s = 0; s < sentences.length && i < words.length; s++) {
    // the last sentence absorbs any surplus words (count drift between text and timing)
    const want = s === sentences.length - 1 ? words.length - i : countTokens(sentences[s]);
    if (want <= 0) continue;
    const grp = words.slice(i, Math.min(words.length, i + want));
    if (grp.length) cues.push(finish(grp));
    i += grp.length;
  }
  if (i < words.length) cues.push(finish(words.slice(i)));
  return cues;
}

// sentence fallback when no narration text is available: break on spoken punctuation
function chunkByPunct(words) {
  const cues = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (STRONG_PUNCT.test(w.word)) { cues.push(finish(cur)); cur = []; }
  }
  if (cur.length) cues.push(finish(cur));
  return cues.length ? cues : (words.length ? [finish(words)] : []);
}

/**
 * @param {Array} cues canonical srt_json cues [{start,end,text,words:[{word,start,end}]}]
 * @param {{chunk?:'auto'|'sentence'|'words', wordsPerCue?:number, text?:string}} opts
 * @returns display cues in the same shape (auto returns the input array untouched)
 */
export function rechunkCues(cues, { chunk = 'auto', wordsPerCue = 4, text = '' } = {}) {
  const list = Array.isArray(cues) ? cues : [];
  if (chunk !== 'sentence' && chunk !== 'words') return list;
  const words = flatten(list);
  if (!words.length) return list; // estimate-era cues without word arrays — nothing to rebuild from
  return chunk === 'words' ? chunkByWords(words, wordsPerCue) : chunkBySentence(words, text);
}
