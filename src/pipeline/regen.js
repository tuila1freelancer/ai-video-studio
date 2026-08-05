// Regenerate ONE scene's voice (B3+4) or visual (B5) — used by the scene-edit UI.
// Every regen APPENDS a take (multi-take history): the previous artifact is snapshotted
// before being replaced, so the user can A/B and roll back non-destructively.
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { newId } from '../util/util.js';
import { synthesizeVoice } from '../providers/tts.js';
import { buildSubtitles } from '../providers/subtitle.js';
import { normalizeForTts, moodOf } from '../providers/tts-normalize.js';
import { normalizeVoice } from '../media/ffmpeg.js';
import { detectLang } from '../util/lang.js';
import { generateSceneDirection } from './direction.js';
import { generateSceneSpec } from '../hyperframe/codegen.js';
import { densityForScene } from '../hyperframe/prompt.js';
import { resolveGuide } from '../styleguide/index.js';
import { heroMediaUri } from '../util/asset-uri.js';
import { sceneMediaResolver } from './brand-assets.js';
import { hash32 } from '../util/util.js';
import { animSize, previewSceneFrame } from '../animation/index.js';
import { backdropForScene } from '../animation/backdrop.js';
import { aiSettingsFor, ttsOverrideFor } from '../core/config.js';
import { ttsFingerprint, fpStamp } from './fingerprint.js';

export async function regenOne(sceneId, what) {
  const sc = DB.getScene(sceneId);
  if (!sc) throw new Error('scene not found');
  const project = DB.getProject(sc.project_id);
  const config = project.config || {};
  const dir = DB.projectDirFor(project.id);
  // history: snapshot the current artifact BEFORE this regen replaces it
  try { DB.snapshotTake(sc, what === 'voice' ? 'voice' : 'visual'); } catch { /* history is best-effort */ }
  if (what === 'voice') {
    const channel = DB.channelOf(project.id);
    const ai = aiSettingsFor(channel);
    const total = DB.getScenes(project.id).length;
    // unique filenames per take — an old take's audio must never be overwritten in place
    const audioOut = join(dir, 'audio', `scene_${sc.idx}_${newId('')}.m4a`);
    const ttsOverride = ttsOverrideFor(channel, config);
    const lang = detectLang(sc.voice_text || '');
    // parity with stages/tts.js: normalized speech, prosody hint, provider word timestamps
    const speakText = normalizeForTts(sc.voice_text || ' ', { lang, lexicon: ttsOverride?.lexicon || ai.tts?.lexicon });
    const r = await synthesizeVoice(speakText, audioOut, { ttsOverride, style: moodOf(sc, total) });
    const padMs = lang === 'vi' ? 650 : 400;
    const { path, duration } = await normalizeVoice(r.path, audioOut.replace(/\.m4a$/, '_n.m4a'), { padMs });
    const sub = await buildSubtitles(path, sc.voice_text || '', Math.max(0.3, duration - padMs / 1000), { language: config.language, engine: ai.subtitle?.engine, words: r.words });
    DB.updateScene(sc.id, { audio_path: path, duration, srt_json: sub.cues, status: 'tts', video_path: null,
      fp: fpStamp(sc, 'tts', ttsFingerprint(sc, { config, channel, ai })) });
    DB.snapshotTake(DB.getScene(sc.id), 'voice', { active: true });
    hub.toProject(project.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'tts', duration });
  } else if (what === 'html') {
    const vm = config.visualMode || 'hyperframe';
    if (vm === 'hyperframe') {
      const total = DB.getScenes(project.id).length;
      const channel = DB.channelOf(project.id);
      const guide = resolveGuide(config);
      const { w, h } = animSize(project.aspect_ratio, 1) /* LOGICAL canvas — render upscales via zoom */;
      const baseAi = aiSettingsFor(channel);
      const baseLlm = baseAi?.llm ? { ...baseAi.llm } : null;
      if (baseLlm) delete baseLlm.modelFallback; // NO-FALLBACK contract — same as the batch lane
      const hfAi = baseLlm
        ? { ...baseAi, llm: config.hyperframe?.model ? { ...baseLlm, model: config.hyperframe.model } : baseLlm }
        : baseAi;
      // fresh art direction for this scene too (regenerate = user wants a new take)
      try {
        const d = await generateSceneDirection(sc, { title: project.title, total, guide, ai: hfAi, language: resolveLang(config, DB.getScenes(project.id)) });
        if (d) { DB.updateScene(sc.id, { visual_prompt: d.visual }); sc.visual_prompt = d.visual; }
      } catch { /* keep the old brief */ }
      const hookVisual = sc.idx > 0 ? (DB.getScenes(project.id)[0]?.visual_prompt || '') : '';
      // P35 regen parity: the single-scene lane passes the SAME flags as the batch lane
      // (captions/consistent/overlay/imageFull/diversity salt/per-scene density) and FAILS
      // LOUDLY — the silent heuristic fallback contradicted the no-fallback contract. P38: the
      // quality tier is gone; the render gate is pass/fail (not-broken + balanced).
      // Same resolver as the batch lane (P40) — project uploads AND the brand folder — so a
      // regenerated scene keeps exactly the media its first pass was designed around.
      const media = sceneMediaResolver(config, { heroMediaUri })(sc);
      const { props } = await generateSceneSpec({
        scene: sc, guide, w, h, idx: sc.idx, total, ai: hfAi,
        density: densityForScene(sc, config.hyperframe?.density),
        creativeDirection: config.hyperframe?.direction,
        captionsOn: config.enableSubtitles !== false,
        consistent: config.hyperframe?.consistent === true,
        imageFullAssets: media,
        overlay: config.overlay?.enabled === true,
        diversitySalt: hash32(String(project.id)),
        hookVisual,
      });
      // P38: per-scene backdrop rotation (parity with the batch lane) — palette stays locked.
      const backdrop = config.hyperframe?.backgroundVariety !== false
        ? backdropForScene(sc, sc.idx, hash32(String(project.id))) : null;
      const plan = { template: 'hyperframe', props: { ...props, ...(backdrop ? { backdrop } : {}) } };
      DB.updateScene(sc.id, { template: plan.template, props: plan.props, status: 'html', video_path: null });
      const fresh = DB.getScene(sc.id);
      const out = join(dir, 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      await previewSceneFrame(fresh, project, config, { outPath: out });
      DB.updateScene(sc.id, { image_path: out });
      DB.snapshotTake(DB.getScene(sc.id), 'visual', { active: true });
      hub.toProject(project.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: plan.template, image: `/api/file?path=${encodeURIComponent(out)}` });
    }
  }
}
