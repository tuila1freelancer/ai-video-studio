// B3+4 — TTS + SRT. Synthesize each scene's voice, loudnorm + pad it, then time subtitles
// against the SPEECH span. Includes the voice-lock heal (P7/P9): a scene that fell back to a
// secondary voice gets one more shot at the primary before we keep the fallback.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { synthesizeVoice } from '../../providers/tts.js';
import { buildSubtitles } from '../../providers/subtitle.js';
import { normalizeVoice } from '../../media/ffmpeg.js';
import { detectLang } from '../../util/lang.js';
import { buildSrt } from '../srt.js';
import { withRetry } from '../../util/retry.js';
import { ttsOverrideFor } from '../../core/config.js';
import { checkStop, notStopped } from '../stop.js';
import { step, op, retryHook } from '../progress.js';
import { mapPool } from '../helpers.js';

// Trailing breath-pad after normalize: Vietnamese syllable endings need a touch more room.
const padMsFor = (lang) => (lang === 'vi' ? 650 : 400);

/** @param {import('../context.js').PipelineContext} ctx */
export async function runTts(ctx) {
  const { projectId, config, channel, ai, dir, resume } = ctx;
  step(projectId, 'b34', 'running', 'Lồng tiếng + phụ đề');
  DB.updateProject(projectId, { current_step: 'b34' });
  const scenes = DB.getScenes(projectId);
  const ttsC = config.parallelTTS ? parseInt(config.ttsConcurrency || 4, 10) : 1;
  const voiceFallbacks = []; // scenes that had to switch voice — re-tried once below
  const ttsOne = async (sc, { trackFallback = true } = {}) => {
    const audioOut = join(dir, 'audio', `scene_${sc.idx}.m4a`);
    const r = await synthesizeVoice(sc.voice_text || ' ', audioOut, { ttsOverride: ttsOverrideFor(channel, config) });
    if (!r.duration || r.duration <= 0) throw new Error('âm thanh rỗng');
    if (r.fallback && trackFallback) {
      voiceFallbacks.push(sc.id);
      op(projectId, `⚠️ Cảnh ${sc.idx + 1}: dùng giọng dự phòng (${r.provider}) — sẽ thử lại giọng chính sau`);
    }
    // per-scene loudnorm + trailing breath pad → mọi cảnh cùng mức âm lượng, mọi provider
    const lang = detectLang(sc.voice_text || '');
    const padMs = padMsFor(lang);
    const { path, duration } = await normalizeVoice(r.path, join(dir, 'audio', `scene_${sc.idx}_n.m4a`), { padMs });
    // captions time against the SPEECH span — the pad is silence, no caption should sit on it
    const speechDur = Math.max(0.3, duration - padMs / 1000);
    const sub = await buildSubtitles(path, sc.voice_text || '', speechDur, { language: config.language, engine: ai.subtitle?.engine });
    const srtPath = join(dir, 'srt', `scene_${sc.idx}.srt`);
    writeFileSync(srtPath, buildSrt(sub.cues));
    DB.updateScene(sc.id, { audio_path: path, duration, srt_path: srtPath, srt_json: sub.cues, status: 'tts' });
    hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'tts', duration });
    return r;
  };
  await mapPool(scenes, ttsC, async (sc) => {
    checkStop(projectId);
    if (resume && sc.audio_path && existsSync(sc.audio_path) && sc.srt_json) return;
    op(projectId, `🎙️ Cảnh ${sc.idx + 1}/${scenes.length}`);
    await withRetry(async () => {
      checkStop(projectId);
      await ttsOne(sc);
    }, { tries: 3, label: `b34 scene ${sc.idx}`, onRetry: retryHook(projectId, 'b34', sc.idx), fatal: notStopped });
  });
  // Voice-lock heal: scenes that fell back to another voice get ONE more shot at the primary
  // (the provider often recovers within minutes). Still on fallback → keep what we have.
  if (voiceFallbacks.length) {
    op(projectId, `🩹 Thử lại giọng chính cho ${voiceFallbacks.length} cảnh dùng giọng dự phòng…`);
    for (const sid of voiceFallbacks.splice(0)) {
      checkStop(projectId);
      const sc = DB.getScene(sid);
      try {
        const r = await ttsOne(sc, { trackFallback: false });
        if (r.fallback) logger.warn(`scene ${sc.idx}: vẫn phải dùng giọng dự phòng (${r.provider})`, { projectId });
        else op(projectId, `✅ Cảnh ${sc.idx + 1}: đã khôi phục giọng chính`);
      } catch (e) { logger.warn(`voice-heal scene ${sc.idx}: ${e.message} — giữ audio hiện có`, { projectId }); }
    }
  }
  step(projectId, 'b34', 'done');
  checkStop(projectId);
}
