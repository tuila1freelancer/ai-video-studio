// Pre-TTS timing seed (scenes-first pipeline). Visuals now run BEFORE the voice exists, but
// hyperframe codegen art-directs against scene.duration + srt_json word beats — so every
// unvoiced scene gets an ESTIMATED duration (speech-rate model) and estimated word cues
// before B5. The real TTS pass overwrites both unconditionally (stages/tts.js writes
// duration + srt_json on every synthesis), so estimates can never leak into a voiced scene:
// the only scenes seeded here are the ones whose audio_path is still NULL.
import * as DB from '../db/index.js';
import { estimateSpeechDuration, estimateWordTiming } from '../providers/subtitle.js';
import { LANG_WPS } from '../providers/llm.js';
import { detectLang } from '../util/lang.js';
import { logger } from '../util/log.js';

/** @param {import('./context.js').PipelineContext} ctx */
export function seedEstimatedTiming(ctx) {
  const { projectId, config } = ctx;
  let seeded = 0;
  for (const sc of DB.getScenes(projectId)) {
    if (sc.audio_path) continue; // real voice already exists — its timing is authoritative
    const lang = (config.language && config.language !== 'auto') ? config.language : detectLang(sc.voice_text || '');
    const duration = estimateSpeechDuration(sc.voice_text || '', lang, LANG_WPS);
    const padS = (lang === 'vi' ? 650 : 400) / 1000; // cues span the SPEECH, not the breath pad
    const { cues } = estimateWordTiming(sc.voice_text || '', Math.max(0.5, duration - padS));
    DB.updateScene(sc.id, { duration, srt_json: cues });
    seeded++;
  }
  if (seeded) logger.info(`seeded estimated timing for ${seeded} scene(s)`, { projectId });
  return seeded;
}
