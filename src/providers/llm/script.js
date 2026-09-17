// Sentence splitting, noun picking and the deterministic offline script writer.
import { wordCount } from '../../util/util.js';
import { sentences as segmentSentences } from '../../i18n/segment.js';
import { phrase, chapterLabel } from '../../i18n/script-phrases.js';

// ---- Sentence splitting ----
// Thai writes without sentence-final punctuation at all, so no regex can find its boundaries.
// Pass the language wherever it is known; without one this is the punctuation split it has
// always been.
export function splitSentences(text, language) {
  return segmentSentences(text, language);
}

export function topNouns(text, n = 4) {
  const stop = new Set('the a an and or but of to in on for with is are was were be this that những và của là một các cho với trong đã sẽ được'.split(' '));
  const freq = {};
  for (const w of (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])) {
    if (w.length < 4 || stop.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

// Build a script from arbitrary text, chunked to fit sceneCount scenes ~ wordsPerScene.
export function offlineScript(sourceText, { title, sceneCount, wordsPerScene, structure = false, language }) {
  // Long-video structure without an LLM: paragraphs become chapters with a
  // chapter-break scene (narrated heading) so tens-of-minutes videos get an arc.
  if (structure && sceneCount >= 18) {
    const paras = String(sourceText || '').split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => wordCount(p) >= 12);
    if (paras.length >= 3) {
      const per = Math.max(2, Math.round((sceneCount - paras.length) / paras.length));
      const scenes = [];
      paras.forEach((p, i) => {
        // spoken heading must be a WHOLE clause — never a mid-word slice(0,60) cut; the card's
        // short heading is derived on a word boundary from it.
        const firstSent = (splitSentences(p, language)[0] || p).trim();
        const head = firstSent.length > 90 ? firstSent.slice(0, 90).replace(/\s+\S*$/, '') : firstSent;
        const cardHeading = head.length > 40 ? head.slice(0, 40).replace(/\s+\S*$/, '') : head;
        scenes.push({
          voice: head, keywords: topNouns(p, 3), visualPrompt: head,
          template: 'chapter-break', props: { chapter: chapterLabel(language, i + 1), heading: cardHeading },
        });
        const sub = offlineScript(p, { title, sceneCount: per, wordsPerScene, language });
        scenes.push(...sub.scenes);
      });
      scenes.push({ voice: phrase(language, 'subscribe'), keywords: [phrase(language, 'subscribeKw')], visualPrompt: title });
      return { title, scenes };
    }
  }
  const sentences = splitSentences(sourceText, language);
  const scenes = [];
  if (!sentences.length) {
    // no usable text — fabricate evenly from the topic
    for (let i = 0; i < sceneCount; i++) {
      scenes.push({ voice: `${title}. ${phrase(language, 'part')} ${i + 1}.`, visualPrompt: title, keywords: topNouns(title, 3) });
    }
    return { title, scenes };
  }
  // distribute sentences across scenes targeting wordsPerScene
  let bucket = [];
  let bucketWords = 0;
  const flush = () => {
    if (!bucket.length) return;
    const voice = bucket.join(' ');
    scenes.push({ voice, visualPrompt: voice.slice(0, 90), keywords: topNouns(voice, 3) });
    bucket = []; bucketWords = 0;
  };
  for (const s of sentences) {
    bucket.push(s); bucketWords += wordCount(s);
    if (bucketWords >= wordsPerScene) flush();
  }
  flush();
  // pad or trim toward sceneCount when we have a hard duration target
  while (scenes.length < sceneCount && scenes.length > 0) {
    // split the longest scene into two
    let li = 0; for (let i = 1; i < scenes.length; i++) if (wordCount(scenes[i].voice) > wordCount(scenes[li].voice)) li = i;
    const parts = splitSentences(scenes[li].voice);
    if (parts.length < 2) break;
    const mid = Math.ceil(parts.length / 2);
    const a = parts.slice(0, mid).join(' '), b = parts.slice(mid).join(' ');
    scenes.splice(li, 1,
      { voice: a, visualPrompt: a.slice(0, 90), keywords: topNouns(a, 3) },
      { voice: b, visualPrompt: b.slice(0, 90), keywords: topNouns(b, 3) });
  }
  return { title, scenes };
}
