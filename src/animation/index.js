// High-level animation-mode API used by the pipeline runner and routes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenePage } from './harness.js';
import { buildTemplate, makeCtx, listTemplates } from './templates.js';
import { getTheme } from './themes.js';
import { themeFromGuide, resolveGuide, normalizeGuide } from '../styleguide/index.js';
import { planScene, planScenes } from './planner.js';
import { beatWarpMap } from './timewarp.js';
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
  let plan = scene.template && scene.props
    ? { template: scene.template, props: scene.props }
    : planScene(scene, { idx: scene.idx, total: extras.total || 9999, title: project.title, brand });
  // HyperFrame scenes carry their style guide in props — the whole page (bg canvas, captions,
  // progress bar) follows the guide's palette instead of the classic theme. In a hyperframe
  // project the guide also drives FALLBACK-template scenes and the outro, so a scene that
  // dropped to the heuristic planner can never break the video's visual identity.
  let theme = plan.template === 'hyperframe' && plan.props?.guide
    ? themeFromGuide(normalizeGuide(plan.props.guide))
    : (config.visualMode === 'hyperframe'
      ? themeFromGuide(resolveGuide(config))
      : getTheme(config.theme || 'neon-tech'));
  ({ plan, theme } = applyBrandFont(plan, theme, config));
  // captions resolve BEFORE the template builds: word timings feed ctx.accentTimes so
  // template motion lands on the narration's beats (still deterministic — srt_json is data)
  const captions = config.enableSubtitles !== false ? (scene.srt_json || []) : [];
  const ctx = makeCtx({ w, h, theme, seed: scene.idx + 1, duration, idx: scene.idx, captions: scene.srt_json || [] });
  const tpl = buildTemplate(plan.template, plan.props, ctx);
  applyCustomOverride(tpl, plan.props);
  if (config.gsapFx === false) delete tpl.script; // safety valve: pure-CSS render
  const placement = brand ? planBrandPlacement(brand, {
    templateId: plan.template, idx: scene.idx, total: extras.total || 9999, captionsOn: captions.length > 0,
  }) : null;
  return buildScenePage({
    w, h, theme, seed: scene.idx + 1, duration,
    // Time-warp (scenes-first order): a hyperframe script bakes absolute animation seconds
    // for the duration it was AUTHORED at (props.plannedDur — an estimate when visuals ran
    // before TTS). tplScale = planned/real lets the harness drive the template timeline in
    // authored coordinates while captions/progress/audio stay on real time, so the
    // choreography stretches/compresses to fill the real voice instead of cutting or
    // freezing. tplWarp upgrades that to PER-WORD sync: each baked beat's authored time is
    // pinned to the real moment its word is spoken (beatWarpMap), so beat-timed elements
    // land exactly on the narration. HYPERFRAME ONLY: regular templates rebuild their
    // script against the real duration at render time, and a template switch keeps the old
    // hyperframe props — warping those scripts would slow-motion authored-real motion.
    tplScale: plan.template === 'hyperframe' ? templateTimeScale(plan.props?.plannedDur, duration) : 1,
    tplWarp: plan.template === 'hyperframe' && plan.props?.plannedDur
      ? beatWarpMap(plan.props.beats, plan.props.plannedDur, duration, scene.srt_json)
      : null,
    progressStart: extras.progressStart || 0, progressTotal: extras.progressTotal || 0,
    template: tpl, captions,
    live: !!extras.live, liveAudioUrl: extras.liveAudioUrl || null,
    watermark: brand ? null : resolveWatermark(config),
    brand: placement ? buildBrandLayer(brand, placement, { w, h, theme }) : null,
    captionStyle: captionStyleFrom(config, theme, { w, h }),
  });
}

/**
 * planned/real timeline ratio for the harness. Snaps to 1 inside ±4% (imperceptible; keeps
 * legacy pixel-identical), clamps to [0.5, 2] so a wild estimate can never slow-motion or
 * chipmunk the choreography beyond recognition.
 */
export function templateTimeScale(plannedDur, actualDur) {
  const p = +plannedDur, a = +actualDur;
  if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0 || a <= 0) return 1;
  const k = p / a;
  if (Math.abs(k - 1) < 0.04) return 1;
  return Math.min(2, Math.max(0.5, +k.toFixed(4)));
}

// Brand-font override (config.fonts.display, layered per-channel/per-video through the
// normal config chain): the owner's family leads the stack; the vendored Vietnamese-safe
// families remain the fallback. Hyperframe scenes get it through their guide (drives
// .hf-kw/.hf-kw2/.hf-stat-v); animation scenes through theme.font.
export function brandFontStack(config) {
  const fam = String(config?.fonts?.display || '').replace(/['"<>]/g, '').trim();
  return fam ? `'${fam}', 'Be Vietnam Pro', sans-serif` : null;
}
function applyBrandFont(plan, theme, config) {
  const stack = brandFontStack(config);
  if (!stack) return { plan, theme };
  if (plan.props?.guide) {
    plan = { ...plan, props: { ...plan.props, guide: { ...plan.props.guide, fonts: { ...(plan.props.guide.fonts || {}), display: stack } } } };
  }
  if ((config.visualMode || 'animation') === 'animation') theme = { ...theme, font: stack };
  return { plan, theme };
}

// Direct-edit lane (Scene Studio): owner-authored markup/css/script in props.__custom
// replaces the TEMPLATE output only — page chrome (captions, brand layer, progress bar,
// watermark) stays system-managed, so a hand edit can never break the video's identity.
function applyCustomOverride(tpl, props) {
  const c = props?.__custom;
  if (!c) return;
  if (typeof c.html === 'string') tpl.html = c.html;
  if (typeof c.css === 'string') tpl.css = `${tpl.css || ''}\n/* __custom */\n${c.css}`;
  if (typeof c.script === 'string') tpl.script = c.script;
}

/**
 * The scene's EFFECTIVE template source (what the render will use) — feeds the
 * Scene Studio direct-HTML editor. Same plan/theme/ctx derivation as buildSceneHtml.
 */
export function sceneTemplateSource(scene, project, config) {
  const { w, h } = animSize(project.aspect_ratio, config.resolutionScale || 1);
  const duration = scene.duration || config.sceneDuration || 6;
  const brand = resolveBrandKit(config);
  let plan = scene.template && scene.props
    ? { template: scene.template, props: scene.props }
    : planScene(scene, { idx: scene.idx, total: 9999, title: project.title, brand });
  let theme = plan.template === 'hyperframe' && plan.props?.guide
    ? themeFromGuide(normalizeGuide(plan.props.guide))
    : (config.visualMode === 'hyperframe'
      ? themeFromGuide(resolveGuide(config))
      : getTheme(config.theme || 'neon-tech'));
  ({ plan, theme } = applyBrandFont(plan, theme, config));
  const ctx = makeCtx({ w, h, theme, seed: scene.idx + 1, duration, idx: scene.idx, captions: scene.srt_json || [] });
  const tpl = buildTemplate(plan.template, plan.props, ctx);
  applyCustomOverride(tpl, plan.props);
  return { template: plan.template, html: tpl.html || '', css: tpl.css || '', script: tpl.script || '', hasCustom: !!plan.props?.__custom };
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
export async function renderOutroScene(project, config, { dir, progressStart, progressTotal, duration = 2.6, related = null } = {}) {
  const brand = resolveBrandKit(config);
  const scene = {
    idx: 998, voice_text: '', srt_json: [], duration,
    template: 'cta-outro',
    props: {
      heading: 'Cảm ơn đã xem', sub: (project.title || '').slice(0, 60),
      cta: brand?.channelName ? `Đăng ký ${brand.channelName}` : 'Đăng ký kênh',
      next: related ? String(related).slice(0, 56) : undefined, // end-screen cross-promo line
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
