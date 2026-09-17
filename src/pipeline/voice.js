// One scene's narration, from script line to timed captions: normalised speech → the provider
// chain → per-scene loudness with the language's breath pad → cues. The B3+4 stage and the
// single-scene regen both run exactly this; file naming, fallback tracking and bookkeeping stay
// with the caller.
import { synthesizeVoice } from '../providers/tts.js';
import { buildSubtitles } from '../providers/subtitle.js';
import { normalizeForTts, moodOf } from '../providers/tts-normalize.js';
import { normalizeVoice } from '../media/ffmpeg.js';
import { m } from '../i18n/t.js';

/**
 * @param {object} sc scene row
 * @param {{lang:string, padMs:number, ai:object, ttsOverride:object|null|undefined, total:number, audioOut:string, normOut:string}} args
 * @returns {Promise<{r:object, path:string, duration:number, cues:object[]}>} `r` is the raw synth result (provider, fallback, words)
 */
export async function voiceScene(sc, { lang, padMs, ai, ttsOverride, total, audioOut, normOut }) {
  // The synthesizer SPEAKS the normalized expansion ('85%' → '85 phần trăm', per-channel
  // lexicon); captions keep the ORIGINAL script (digits stay on screen — P11 number-beat
  // detection intact; the align engine spans '85%' over the spoken expansion's time).
  const speakText = normalizeForTts(sc.voice_text || ' ', { lang, lexicon: ttsOverride?.lexicon || ai.tts?.lexicon });
  const r = await synthesizeVoice(speakText, audioOut, { ttsOverride, style: moodOf(sc, total), lang });
  if (!r.duration || r.duration <= 0) throw new Error(m('âm thanh rỗng'));
  // per-scene loudnorm + trailing breath pad → every scene at the same loudness, across all providers
  const { path, duration } = await normalizeVoice(r.path, normOut, { padMs });
  // captions time against the SPEECH span — the pad is silence, no caption should sit on it
  const speechDur = Math.max(0.3, duration - padMs / 1000);
  // provider-native word timestamps (e.g. ElevenLabs with-timestamps) skip transcription
  const sub = await buildSubtitles(path, sc.voice_text || '', speechDur, { language: lang, engine: ai.subtitle?.engine, words: r.words });
  return { r, path, duration, cues: sub.cues };
}
