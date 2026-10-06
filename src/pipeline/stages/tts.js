// B3+4 — TTS + SRT. Synthesize each scene's voice, loudnorm + pad it, then time subtitles
// against the SPEECH span. Includes the voice-lock heal (P7/P9): a scene that fell back to a
// secondary voice gets one more shot at the primary before we keep the fallback.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { voiceScene } from '../voice.js';
import { resolveLang, langName, padMsFor } from '../../util/lang.js';
import { buildSrt } from '../srt.js';
import { withRetry } from '../../util/retry.js';
import { ttsOverrideFor } from '../../core/config.js';
import { checkStop, notStopped } from '../stop.js';
import { step, op, retryHook } from '../progress.js';
import { mapPool } from '../helpers.js';
import { ttsFingerprint, fpCurrent, fpStamp } from '../fingerprint.js';

import { m, tp } from '../../i18n/t.js';
/** @param {import('../context.js').PipelineContext} ctx */
export async function runTts(ctx) {
  const { projectId, config, channel, ai, dir, resume } = ctx;
  step(projectId, 'b34', 'running', m('Lồng tiếng + phụ đề'));
  DB.updateProject(projectId, { current_step: 'b34' });
  const scenes = DB.getScenes(projectId);
  // SILENT MODE (P40): a music-only cut — captions and motion still land on the script's timing,
  // but no voice is synthesized and no TTS credit is spent. The estimated timing seeded before
  // B5 is already on the scene rows, so the whole downstream (render, concat, subtitles) works
  // unchanged; each scene just gets a silent track of its own planned length.
  if (config.enableVoice === false) {
    const { makeSilence } = await import('../../media/ffmpeg.js');
    const { estimateWordTiming } = await import('../../providers/subtitle.js');
    op(projectId, m('🔇 Chế độ không lời: bỏ qua lồng tiếng, giữ nhịp theo kịch bản'));
    for (const sc of scenes) {
      checkStop(projectId);
      const duration = Math.max(1.5, sc.duration || config.sceneDuration || 6);
      const audioOut = join(dir, 'audio', `scene_${sc.idx}_silent.m4a`);
      if (!existsSync(audioOut)) await makeSilence(audioOut, duration);
      const { cues } = estimateWordTiming(sc.voice_text || '', duration);
      const srtPath = join(dir, 'srt', `scene_${sc.idx}.srt`);
      writeFileSync(srtPath, buildSrt(cues));
      DB.updateScene(sc.id, { audio_path: audioOut, duration, srt_path: srtPath, srt_json: cues, status: 'tts' });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'tts', duration });
    }
    step(projectId, 'b34', 'done', m('không lời'));
    return;
  }
  // MISSING-VOICE WARNING. langVoices is how the user pins a voice per language; when the
  // video's language has no entry, resolveTarget silently falls through to the default provider
  // — which is how three English-narrated scenes ended up read by a Vietnamese voice. Warn, never
  // block: an offline install and a keyless setup must both still be able to make a video.
  // THE language of this video — declared by the user, or the majority of what the scenes
  // actually say. Every scene is voiced, padded and captioned in it; a per-scene re-detection
  // would let one short line drag the whole video onto another voice.
  const videoLang = resolveLang(config, scenes);
  {
    const lv = ai.tts?.langVoices?.[videoLang];
    if (!lv?.provider) {
      op(projectId, tp`⚠️ Chưa ghim giọng cho ${langName(videoLang)} — sẽ dùng provider mặc định (${ai.tts?.provider || 'edge'}). Vào Cài đặt → Giọng mặc định theo ngôn ngữ để chọn.`);
      logger.warn(`no langVoices entry for ${videoLang} — falling back to ${ai.tts?.provider || 'edge'}`, { projectId, stage: 'b34' });
    }
  }
  const ttsC = config.parallelTTS ? parseInt(config.ttsConcurrency || 4, 10) : 1;
  const voiceFallbacks = []; // scenes that had to switch voice — re-tried once below
  // B3+4 pads by the VIDEO language, never by a per-scene re-detection.
  const padMs = padMsFor(videoLang);
  const ttsOne = async (sc, { trackFallback = true } = {}) => {
    const audioOut = join(dir, 'audio', `scene_${sc.idx}.m4a`);
    const ttsOverride = ttsOverrideFor(channel, config);
    const { r, path, duration, cues } = await voiceScene(sc, {
      lang: videoLang, padMs, ai, ttsOverride, total: scenes.length, audioOut, normOut: join(dir, 'audio', `scene_${sc.idx}_n.m4a`),
    });
    if (r.fallback && trackFallback) {
      voiceFallbacks.push(sc.id);
      op(projectId, tp`⚠️ Cảnh ${sc.idx + 1}: dùng giọng dự phòng (${r.provider}) — sẽ thử lại giọng chính sau`);
    }
    const srtPath = join(dir, 'srt', `scene_${sc.idx}.srt`);
    writeFileSync(srtPath, buildSrt(cues));
    DB.updateScene(sc.id, { audio_path: path, duration, srt_path: srtPath, srt_json: cues, status: 'tts',
      fp: fpStamp(sc, 'tts', ttsFingerprint(sc, ctx)) });
    hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'tts', duration });
    return r;
  };
  await mapPool(scenes, ttsC, async (sc) => {
    checkStop(projectId);
    if (resume && sc.audio_path && existsSync(sc.audio_path) && sc.srt_json) {
      // content-hash resume: an existing artifact is only kept while its INPUTS are unchanged
      if (fpCurrent(sc, 'tts', ttsFingerprint(sc, ctx))) return;
      op(projectId, tp`♻️ Cảnh ${sc.idx + 1}: lời thoại/giọng đã thay đổi — thu âm lại`);
      DB.updateScene(sc.id, { video_path: null }); // the clip carries the old voice → re-render
    }
    op(projectId, tp`🎙️ Cảnh ${sc.idx + 1}/${scenes.length}`);
    await withRetry(async () => {
      checkStop(projectId);
      await ttsOne(sc);
    }, { tries: 3, label: `b34 scene ${sc.idx}`, onRetry: retryHook(projectId, 'b34', sc.idx), fatal: notStopped });
  });
  // Voice-lock heal: scenes that fell back to another voice get ONE more shot at the primary
  // (the provider often recovers within minutes). Still on fallback → keep what we have.
  if (voiceFallbacks.length) {
    op(projectId, tp`🩹 Thử lại giọng chính cho ${voiceFallbacks.length} cảnh dùng giọng dự phòng…`);
    for (const sid of voiceFallbacks.splice(0)) {
      checkStop(projectId);
      const sc = DB.getScene(sid);
      try {
        const r = await ttsOne(sc, { trackFallback: false });
        if (r.fallback) logger.warn(tp`scene ${sc.idx}: vẫn phải dùng giọng dự phòng (${r.provider})`, { projectId });
        else op(projectId, tp`✅ Cảnh ${sc.idx + 1}: đã khôi phục giọng chính`);
      } catch (e) { logger.warn(tp`voice-heal scene ${sc.idx}: ${e.message} — giữ audio hiện có`, { projectId }); }
    }
  }
  step(projectId, 'b34', 'done');
  checkStop(projectId);
}
