// Multi-aspect repurposing: clone a finished project into a derived one at a new aspect
// ratio and re-render through the SAME core — no crop, no re-synthesis. Animation scenes
// reflow natively off project.aspect_ratio; audio + captions are reused VERBATIM
// (P7/P9 untouched); every clip re-renders because video_path starts null (P8).
// HyperFrame specs are render-validated at the TARGET size first: a px-hardcoded spec
// that breaks on reflow drops its props so B5 regenerates/replans just that scene
// instead of shipping an off-frame layout.
import * as DB from '../db/index.js';
import { logger } from '../util/log.js';
import { renderValidate } from '../hyperframe/validate.js';
import { resolveGuide } from '../styleguide/index.js';
import { animSize } from '../animation/index.js';
import { m, tp } from '../i18n/t.js';

const RATIO_TAG = { '9:16': 'Dọc', '16:9': 'Ngang', '1:1': 'Vuông', '4:5': '4:5' };

/**
 * @param {string} sourceId
 * @param {{aspectRatio: '9:16'|'16:9'|'1:1'|'4:5'}} opts
 * @returns {{project: object, revalidated: number, dropped: number}}
 */
export async function repurposeProject(sourceId, { aspectRatio } = {}) {
  const src = DB.getProject(sourceId);
  if (!src) throw new Error('project not found');
  if (!aspectRatio || aspectRatio === src.aspect_ratio) throw new Error(m('cần một tỉ lệ khung KHÁC bản gốc'));
  const srcScenes = DB.getScenes(sourceId);
  if (!srcScenes.length) throw new Error(m('dự án nguồn chưa có cảnh'));

  const config = { ...(src.config || {}), aspectRatio };
  const project = DB.createProject({
    title: `${src.title} (${RATIO_TAG[aspectRatio] || aspectRatio})`.slice(0, 80),
    topic: src.topic, inputType: src.input_type,
    aspectRatio, config, channelId: src.channel_id,
  });
  DB.projectDirFor(project.id);

  // clone scenes, then attach the reusable artifacts (voice + captions verbatim)
  const cloned = DB.replaceScenes(project.id, srcScenes.map((s) => ({
    voice: s.voice_text, visualPrompt: s.visual_prompt, keywords: s.keywords,
    template: s.template, props: s.props,
  })));
  const visualMode = config.visualMode || 'hyperframe';
  for (let i = 0; i < cloned.length; i++) {
    const s = srcScenes[i];
    DB.updateScene(cloned[i].id, {
      audio_path: s.audio_path, srt_path: s.srt_path, srt_json: s.srt_json,
      duration: s.duration, status: s.audio_path ? 'tts' : 'script',
      // image mode: backgrounds are aspect-sized → rebuilt; anim modes: preview only
      video_path: null,
    });
  }

  // Reflow safety: validate each hyperframe spec at the TARGET size; a spec whose layout
  // breaks (off-screen/caption collision/empty) loses its props so B5 redoes that scene.
  let revalidated = 0, dropped = 0;
  if (visualMode === 'hyperframe') {
    const guide = resolveGuide(config);
    const { w, h } = animSize(aspectRatio, 1) /* LOGICAL canvas — gate must match the render space */;
    const fresh = DB.getScenes(project.id);
    for (const sc of fresh) {
      if (!(sc.template === 'hyperframe' && sc.props?.script)) continue;
      try {
        const rv = await renderValidate({
          spec: sc.props, guide, w, h,
          duration: Math.max(1.5, sc.duration || 6),
          beats: sc.props.beats || [], narration: sc.voice_text || '',
        });
        revalidated++;
        if (!rv.ok && /off-screen|bottom of the frame|renders empty|threw at runtime/i.test(rv.defects.join(' | '))) {
          DB.updateScene(sc.id, { template: null, props: null, status: 'script' });
          dropped++;
        }
      } catch (e) { logger.warn(tp`Đổi tỉ lệ: cảnh ${sc.idx + 1} validate lỗi: ${e.message}`, { projectId: project.id, sceneIdx: sc.idx }); }
    }
  }
  logger.info(tp`📱 Đổi tỉ lệ ${sourceId} → ${project.id} (${aspectRatio}): ${cloned.length} cảnh, ${revalidated} spec giữ nguyên, ${dropped} cảnh dàn lại`, { projectId: project.id });
  return { project: DB.getProject(project.id), revalidated, dropped };
}
