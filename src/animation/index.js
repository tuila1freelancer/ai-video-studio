// High-level animation-mode API used by the pipeline runner and routes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenePage } from './harness.js';
import { buildTemplate, makeCtx, listTemplates } from './templates.js';
import { getTheme } from './themes.js';
import { themeFromGuide, resolveGuide, normalizeGuide } from '../styleguide/index.js';
import { planScene, planScenes } from './planner.js';
import { renderScenePage, renderPreviewFrame } from './renderer.js';
import { resolveBrandKit, planBrandPlacement, buildBrandLayer, imgDataUri } from './branding.js';
import { captionStyleFrom } from '../subtitles/presets.js';
import { ratioToSize } from '../util/util.js';

export { listTemplates, planScenes, planScene, resolveBrandKit };

function resolveWatermark(config) {
  if (config?.logo?.path && existsSync(config.logo.path)) {
    const uri = imgDataUri(config.logo.path);
    if (uri) return { imageUri: uri };
  }
  const t = (config?.watermarkText ?? '').trim();
  return t ? { text: t } : null;
}

// Resolution scale: 1 = 1080-class (default), 2 = 4K-class.
export function animSize(aspectRatio, scale = 1) {
  const s = ratioToSize(aspectRatio);
  const k = scale >= 2 ? 2 : 1;
  return { w: s.w * k, h: s.h * k };
}

/**
 * Build the full HTML page for a scene in animation mode.
 * scene: DB row (voice_text, srt_json, idx, template, props, duration)
 * extras: { progressStart, progressTotal, durationOverride }
 */
export function buildSceneHtml(scene, project, config, extras = {}) {
  const { w, h } = animSize(project.aspect_ratio, config.resolutionScale || 1);
  const duration = extras.durationOverride || scene.duration || config.sceneDuration || 6;
  const brand = resolveBrandKit(config);
  const plan = scene.template && scene.props
    ? { template: scene.template, props: scene.props }
    : planScene(scene, { idx: scene.idx, total: extras.total || 9999, title: project.title, brand });
  // HyperFrame scenes carry their style guide in props — the whole page (bg canvas, captions,
  // progress bar) follows the guide's palette instead of the classic theme. In a hyperframe
  // project the guide also drives FALLBACK-template scenes and the outro, so a scene that
  // dropped to the heuristic planner can never break the video's visual identity.
  const theme = plan.template === 'hyperframe' && plan.props?.guide
    ? themeFromGuide(normalizeGuide(plan.props.guide))
    : (config.visualMode === 'hyperframe'
      ? themeFromGuide(resolveGuide(config))
      : getTheme(config.theme || 'neon-tech'));
  // captions resolve BEFORE the template builds: word timings feed ctx.accentTimes so
  // template motion lands on the narration's beats (still deterministic — srt_json is data)
  const captions = config.enableSubtitles !== false ? (scene.srt_json || []) : [];
  const ctx = makeCtx({ w, h, theme, seed: scene.idx + 1, duration, idx: scene.idx, captions: scene.srt_json || [] });
  const tpl = buildTemplate(plan.template, plan.props, ctx);
  if (config.gsapFx === false) delete tpl.script; // safety valve: pure-CSS render
  const placement = brand ? planBrandPlacement(brand, {
    templateId: plan.template, idx: scene.idx, total: extras.total || 9999, captionsOn: captions.length > 0,
  }) : null;
  return buildScenePage({
    w, h, theme, seed: scene.idx + 1, duration,
    progressStart: extras.progressStart || 0, progressTotal: extras.progressTotal || 0,
    template: tpl, captions,
    live: !!extras.live, liveAudioUrl: extras.liveAudioUrl || null,
    watermark: brand ? null : resolveWatermark(config),
    brand: placement ? buildBrandLayer(brand, placement, { w, h, theme }) : null,
    captionStyle: captionStyleFrom(config, theme, { w, h }),
  });
}

// Render a full scene → mp4 (+ mid-frame preview jpeg).
export async function renderAnimationScene(scene, project, config, { dir, progressStart, progressTotal, total, onProgress, onLog } = {}) {
  const { w, h } = animSize(project.aspect_ratio, config.resolutionScale || 1);
  const fps = parseInt(config.fps || 30, 10);
  const duration = Math.max(1.5, scene.duration || config.sceneDuration || 6);
  const html = buildSceneHtml(scene, project, config, { progressStart, progressTotal, total, durationOverride: duration });
  const outPath = join(dir, `scene_${String(scene.idx).padStart(3, '0')}.mp4`);
  const previewPath = join(dir, `scene_${String(scene.idx).padStart(3, '0')}_preview.jpg`);
  const res = await renderScenePage({
    html, w, h, fps, duration,
    audioPath: scene.audio_path && existsSync(scene.audio_path) ? scene.audio_path : null,
    outPath, previewPath, onProgress, onLog,
  });
  return { ...res, preview: existsSync(previewPath) ? previewPath : null };
}

// Render a synthetic outro clip (no narration). CTA carries the channel name when branded.
export async function renderOutroScene(project, config, { dir, progressStart, progressTotal, duration = 2.6 } = {}) {
  const brand = resolveBrandKit(config);
  const scene = {
    idx: 998, voice_text: '', srt_json: [], duration,
    template: 'cta-outro',
    props: {
      heading: 'Cảm ơn đã xem', sub: (project.title || '').slice(0, 60),
      cta: brand?.channelName ? `Đăng ký ${brand.channelName}` : 'Đăng ký kênh',
    },
  };
  const res = await renderAnimationScene(scene, project, config, { dir, progressStart, progressTotal });
  return res;
}

// One preview frame (UI helper).
export async function previewSceneFrame(scene, project, config, { outPath, t } = {}) {
  const { w, h } = animSize(project.aspect_ratio, 1); // previews always 1080-class
  const duration = Math.max(1.5, scene.duration || config.sceneDuration || 6);
  const html = buildSceneHtml(scene, project, config, { durationOverride: duration, progressStart: 0, progressTotal: duration });
  return renderPreviewFrame(html, { w, h, t: t ?? duration / 2, outPath });
}
