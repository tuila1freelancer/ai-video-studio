// Subtitle provider — engines:
//   align    — force-align the KNOWN script text to the audio: whisper donates word
//              timestamps (biased by the script as its decode prompt), the script supplies
//              the displayed words. Exact words + real timing. Falls back to estimate.
//   whisper  — raw transcription (only better when the audio's text is unknown)
//   estimate — distribute the known text across the duration weighted by word length
// Provider-native word timestamps (e.g. ElevenLabs with-timestamps) win over every engine.
import { aiSettings } from '../db/index.js';
import { transcribeWords, whisperAvailable, groupWordsIntoCues } from '../media/whisper.js';
import { alignWords } from '../media/align.js';
import { logger } from '../util/log.js';

// Ratio of ACTUAL spoken pace to the LANG_WPS writing budget. LANG_WPS (vi 4.4) sizes how
// much text fits a slot; measured LarVoice vi delivery runs at ~4.29 words/s (36 words →
// 8.39s speech), i.e. ~97% of budget — 0.95 leaves a touch of slack for slower voices.
// One constant, applied to every language, so the estimator can never drift from the
// P5-pinned budget table on its own.
const SPOKEN_VS_BUDGET = 0.95;

/**
 * Estimate how long a voice line will take to SPEAK, before any audio exists (scenes-first
 * pipeline: visuals are planned against this, then real TTS overwrites it). Includes the
 * per-language trailing breath pad so the number is comparable to scenes.duration as
 * written by the TTS stage. Clamped to [2.5, 40]s.
 */
export function estimateSpeechDuration(text, lang, wpsTable) {
  const words = (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).length;
  const wps = ((wpsTable || {})[lang] || 3.0) * SPOKEN_VS_BUDGET;
  const padS = (lang === 'vi' ? 650 : 400) / 1000; // mirror stages/tts.js padMsFor
  return Math.min(40, Math.max(2.5, +(words / Math.max(1, wps) + padS).toFixed(3)));
}

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

export async function buildSubtitles(audioPath, text, duration, { language, onLog, engine: engineOverride, words: providerWords } = {}) {
  // TTS providers that return character/word timestamps give PERFECT timing for the exact
  // script — nothing to transcribe or align.
  if (Array.isArray(providerWords) && providerWords.length) {
    return { words: providerWords, cues: groupWordsIntoCues(providerWords) };
  }
  const engine = engineOverride || (aiSettings().subtitle || {}).engine || 'align';
  if ((engine === 'align' || engine === 'whisper') && whisperAvailable()) {
    // whisper hiccups (busy CPU, transient I/O) deserve one retry before losing real
    // word timings for the whole scene — beats/karaoke are only as good as these stamps.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await transcribeWords(audioPath, { language, onLog, prompt: engine === 'align' ? text : '' });
        if (r.words.length) {
          if (engine === 'whisper') return r; // caller wants the transcription verbatim
          const aligned = alignWords(text, r.words, duration);
          if (aligned) return { words: aligned, cues: groupWordsIntoCues(aligned) };
          logger.warn('forced alignment matched <50% — falling back to estimated timing (script words win)');
          break;
        }
        logger.warn(`whisper returned no words (attempt ${attempt + 1}/2)`);
      } catch (e) {
        logger.warn(`whisper failed (${e.message}) — attempt ${attempt + 1}/2`);
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    if (engine === 'whisper') logger.warn('whisper exhausted; estimating timing');
  }
  return estimateWordTiming(text, duration);
}
