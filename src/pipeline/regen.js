// Regenerate ONE scene's voice (B3+4) or visual (B5) — used by the scene-edit UI.
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { ratioToSize } from '../util/util.js';
import { synthesizeVoice } from '../providers/tts.js';
import { buildSubtitles } from '../providers/subtitle.js';
import { normalizeVoice } from '../media/ffmpeg.js';
import { detectLang } from '../util/lang.js';
import { generateSceneDirection } from './direction.js';
import { generateSceneSpec } from '../hyperframe/codegen.js';
import { resolveGuide } from '../styleguide/index.js';
import { planScene, resolveBrandKit, animSize, previewSceneFrame } from '../animation/index.js';
import { buildSceneBackground } from './visuals.js';
import { aiSettingsFor, ttsOverrideFor } from '../core/config.js';
import { visualOpts } from './helpers.js';

export async function regenOne(sceneId, what) {
  const sc = DB.getScene(sceneId);
  if (!sc) throw new Error('scene not found');
  const project = DB.getProject(sc.project_id);
  const config = project.config || {};
  const size = ratioToSize(project.aspect_ratio);
  const dir = DB.projectDirFor(project.id);
  if (what === 'voice') {
    const channel = DB.channelOf(project.id);
    const audioOut = join(dir, 'audio', `scene_${sc.idx}.m4a`);
    const r = await synthesizeVoice(sc.voice_text || ' ', audioOut, { ttsOverride: ttsOverrideFor(channel, config) });
    const padMs = detectLang(sc.voice_text || '') === 'vi' ? 650 : 400;
    const { path, duration } = await normalizeVoice(r.path, join(dir, 'audio', `scene_${sc.idx}_n.m4a`), { padMs });
    const sub = await buildSubtitles(path, sc.voice_text || '', Math.max(0.3, duration - padMs / 1000), { engine: aiSettingsFor(channel).subtitle?.engine });
    DB.updateScene(sc.id, { audio_path: path, duration, srt_json: sub.cues, status: 'tts' });
    hub.toProject(project.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'tts', duration });
  } else if (what === 'html') {
    const vm = config.visualMode || 'animation';
    if (vm === 'hyperframe') {
      // fresh AI direction for this scene (falls back to the heuristic planner on failure)
      const total = DB.getScenes(project.id).length;
      const channel = DB.channelOf(project.id);
      const guide = resolveGuide(config);
      const { w, h } = animSize(project.aspect_ratio, config.resolutionScale || 1);
      let plan;
      try {
        const baseAi = aiSettingsFor(channel);
        const hfAi = config.hyperframe?.model && baseAi?.llm
          ? { ...baseAi, llm: { ...baseAi.llm, model: config.hyperframe.model } } : baseAi;
        // fresh art direction for this scene too (regenerate = user wants a new take)
        try {
          const d = await generateSceneDirection(sc, { title: project.title, total, guide, ai: hfAi, language: config.language });
          if (d) { DB.updateScene(sc.id, { visual_prompt: d.visual }); sc.visual_prompt = d.visual; }
        } catch { /* keep the old brief */ }
        const hookVisual = sc.idx > 0 ? (DB.getScenes(project.id)[0]?.visual_prompt || '') : '';
        const { props } = await generateSceneSpec({
          scene: sc, guide, w, h, idx: sc.idx, total, ai: hfAi,
          density: config.hyperframe?.density, creativeDirection: config.hyperframe?.direction,
          hookVisual,
        });
        plan = { template: 'hyperframe', props };
      } catch {
        plan = planScene(sc, { idx: sc.idx, total, title: project.title, brand: resolveBrandKit(config) });
      }
      DB.updateScene(sc.id, { template: plan.template, props: plan.props, status: 'html' });
      const fresh = DB.getScene(sc.id);
      const out = join(dir, 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      await previewSceneFrame(fresh, project, config, { outPath: out });
      DB.updateScene(sc.id, { image_path: out });
      hub.toProject(project.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: plan.template, image: `/api/file?path=${encodeURIComponent(out)}` });
    } else if (vm === 'animation') {
      // re-plan template + refresh preview frame
      const total = DB.getScenes(project.id).length;
      const plan = planScene(sc, { idx: sc.idx, total, title: project.title, brand: resolveBrandKit(config) });
      DB.updateScene(sc.id, { template: plan.template, props: plan.props, status: 'html' });
      const fresh = DB.getScene(sc.id);
      const out = join(dir, 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      await previewSceneFrame(fresh, project, config, { outPath: out });
      DB.updateScene(sc.id, { image_path: out });
      hub.toProject(project.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: plan.template, image: `/api/file?path=${encodeURIComponent(out)}` });
    } else {
      const bg = await buildSceneBackground(sc, project, size, visualOpts(config, dir));
      DB.updateScene(sc.id, { image_path: bg, status: 'html' });
      hub.toProject(project.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', image: `/api/file?path=${encodeURIComponent(bg)}` });
    }
  }
}
