// Subtitle provider — whisper word timing, or estimate from text+duration.
import { aiSettings } from '../db/index.js';
import { transcribeWords, whisperAvailable, groupWordsIntoCues } from '../media/whisper.js';
import { logger } from '../util/log.js';

// Distribute words across [0, duration] weighted by word length (offline fallback).
export function estimateWordTiming(text, duration) {
  const tokens = (text || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { words: [], cues: [] };
  const weights = tokens.map((w) => Math.max(2, w.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  const words = tokens.map((w, i) => {
    const dur = (weights[i] / total) * duration;
    const start = t; t += dur;
    return { start: +start.toFixed(3), end: +t.toFixed(3), word: w };
  });
  return { words, cues: groupWordsIntoCues(words) };
}

export async function buildSubtitles(audioPath, text, duration, { language, onLog, engine: engineOverride } = {}) {
  const engine = engineOverride || (aiSettings().subtitle || {}).engine || 'whisper';
  if (engine === 'whisper' && whisperAvailable()) {
    // whisper hiccups (busy CPU, transient I/O) deserve one retry before losing real
    // word timings for the whole scene — beats/karaoke are only as good as these stamps.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await transcribeWords(audioPath, { language, onLog });
        if (r.words.length) return r;
        logger.warn(`whisper returned no words (attempt ${attempt + 1}/2)`);
      } catch (e) {
        logger.warn(`whisper failed (${e.message}) — attempt ${attempt + 1}/2`);
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    logger.warn('whisper exhausted; estimating timing');
  }
  return estimateWordTiming(text, duration);
}
