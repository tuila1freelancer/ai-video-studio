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
import { correctCues } from '../subtitles/llm-correct.js';
import { logger } from '../util/log.js';
import { padMsFor } from '../util/lang.js';

import { m, tp } from '../i18n/t.js';
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
  const padS = padMsFor(lang) / 1000; // the same table stages/tts.js pads with
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
          if (engine === 'whisper') {
            // Raw transcription may mishear proper nouns / numbers / foreign terms — the
            // LLM correction lane (reference-app parity) fixes wording while the contract
            // pins every timestamp + block count. align-engine scenes never need this:
            // their displayed words ARE the script. Toggle: ai.subtitle.llmCorrect.
            const sub = aiSettings().subtitle || {};
            if (sub.llmCorrect !== false) {
              const fixed = await correctCues(r.cues, text, { lang: language, onLog: (m) => logger.info(m) });
              if (fixed.corrected) return { words: r.words, cues: fixed.cues };
            }
            return r; // caller wants the transcription verbatim
          }
          const aligned = alignWords(text, r.words, duration);
          if (aligned) return { words: aligned, cues: groupWordsIntoCues(aligned) };
          logger.warn(m('Phụ đề: khớp cưỡng bức <50% — dùng nhịp ước tính (giữ nguyên chữ kịch bản)'));
          break;
        }
        logger.warn(tp`Phụ đề: whisper không trả về từ nào (lần ${attempt + 1}/2)`);
      } catch (e) {
        logger.warn(tp`Phụ đề: whisper lỗi (${e.message}) — lần ${attempt + 1}/2`);
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    if (engine === 'whisper') logger.warn(m('Phụ đề: whisper thất bại hết lượt — chuyển sang nhịp ước tính'));
  }
  return estimateWordTiming(text, duration);
}
