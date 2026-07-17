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
import { captionStyleFrom, familyName } from '../subtitles/presets.js';
import { rechunkCues } from '../subtitles/chunk.js';
import { ratioToSize, hash32 } from '../util/util.js';

// Per-project seed salt (P31): scene N of two different videos must NOT share randomness
// (particles, ambient layout, FX picks) — before this, seed was `idx + 1` for every video,
// so same-index scenes came out near-identical across projects. Determinism per project is
// preserved (same project + idx → same seed forever); no project id → the legacy seed,
// byte-identical (previews, tests, harness runs without a real project).
export function sceneSeed(project, idx) {
  const base = (idx | 0) + 1;
  return project?.id ? ((hash32(String(project.id)) ^ base) >>> 0) : base;
}

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
  // LOGICAL canvas: layout always happens in the 1080-class px space the LLM authored
  // against (16:9 = 1920x1080, 9:16 = 1080x1920, …). Higher output resolutions upscale
  // LOSSLESSLY via CSS zoom (extras.zoom, set by the renderer) — text/SVG re-rasterize at
  // device resolution, so 4K is true 4K while every px the model wrote keeps its intended
  // relative size. Building the page at physical 4K instead halves the relative size of
  // every authored px (sparse layouts, weak motion, clipped labels).
  const { w, h } = animSize(project.aspect_ratio, 1);
  const duration = extras.durationOverride || scene.duration || config.sceneDuration || 6;
  const brand = resolveBrandKit(config);
  let plan = scene.template && scene.props
    ? { template: scene.template, props: scene.props }
    : planScene(scene, { idx: scene.idx, total: extras.total || 9999, title: project.title, brand });
  if (config.overlay?.enabled && plan.props && !plan.props.overlay) {
    plan = { ...plan, props: { ...plan.props, overlay: true } };
  }
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
  // template motion lands on the narration's beats (still deterministic — srt_json is data).
  // P29: display cues may be re-chunked (sentence / N-word) — a pure rebuild from the SAME
  // word timestamps, so subtitle timing stays glued to the voice; beats keep the raw cues.
  const captions = config.enableSubtitles !== false
    ? rechunkCues(scene.srt_json || [], {
      chunk: config.subtitleChunk, wordsPerCue: config.subtitleWordsPerCue, text: scene.voice_text,
    })
    : [];
  const ctx = makeCtx({ w, h, theme, seed: sceneSeed(project, scene.idx), duration, idx: scene.idx, captions: scene.srt_json || [] });
  const tpl = buildTemplate(plan.template, plan.props, ctx);
  applyCustomOverride(tpl, plan.props);
  // Canvas provenance: a hyperframe spec authored on a different canvas (stamped at codegen)
  // gets a compensating zoom on the camera wrapper so its px land at the intended relative
  // size — spec content only; captions/progress/branding stay in the page's own space.
  if (plan.template === 'hyperframe' && plan.props?.canvasW > 0 && plan.props.canvasW !== w) {
    tpl.css = `${tpl.css || ''}\n.hf-cam{zoom:${(w / plan.props.canvasW).toFixed(4)}}`;
  }
  // Overlay mode: scenes render on the solid key color and later composite onto the
  // owner's footage — the hyperframe template already dropped its stage dressing via
  // props.overlay (set at plan time below), and the page drops its own here.
  const overlayCfg = config.overlay?.enabled ? { key: config.overlay.key || '#050510' } : null;
  if (config.gsapFx === false) delete tpl.script; // safety valve: pure-CSS render
  const placement = brand ? planBrandPlacement(brand, {
    templateId: plan.template, idx: scene.idx, total: extras.total || 9999, captionsOn: captions.length > 0,
  }) : null;
  return buildScenePage({
    w, h, zoom: Math.max(1, +extras.zoom || 1), theme, seed: sceneSeed(project, scene.idx), duration,
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
    // sentence cues run long — let the caption wrap to 2 lines instead of shrinking to dust
    capWrap: config.subtitleChunk === 'sentence',
    // P30 loud-font contract: the page probes these families after load; a miss surfaces
    // in __init's return so the renderer can warn instead of silently substituting.
    fontChecks: [familyName(config.subtitleFont), familyName(config.fonts?.display)].filter(Boolean),
    overlay: overlayCfg,
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
  const { w, h } = animSize(project.aspect_ratio, 1); // editor source lives in the logical canvas
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
  const ctx = makeCtx({ w, h, theme, seed: sceneSeed(project, scene.idx), duration, idx: scene.idx, captions: scene.srt_json || [] });
  const tpl = buildTemplate(plan.template, plan.props, ctx);
  applyCustomOverride(tpl, plan.props);
  return { template: plan.template, html: tpl.html || '', css: tpl.css || '', script: tpl.script || '', hasCustom: !!plan.props?.__custom };
}

// Render a full scene → mp4 (+ mid-frame preview jpeg). In overlay mode the keyed scene
// then composites onto the owner's base footage (slice offset = the scene's start on the
// final timeline, so consecutive scenes ride one continuous shot).
export async function renderAnimationScene(scene, project, config, { dir, progressStart, progressTotal, total, onProgress, onLog } = {}) {
  const k = (config.resolutionScale || 1) >= 2 ? 2 : 1;
  const { w, h } = animSize(project.aspect_ratio, k); // PHYSICAL viewport (4K when k=2)
  const fps = parseInt(config.fps || 30, 10);
  const duration = Math.max(1.5, scene.duration || config.sceneDuration || 6);
  const html = buildSceneHtml(scene, project, config, { progressStart, progressTotal, total, durationOverride: duration, zoom: k });
  const overlayOn = !!(config.overlay?.enabled && config.overlay.source && existsSync(config.overlay.source));
  const outPath = join(dir, `scene_${String(scene.idx).padStart(3, '0')}${overlayOn ? '_key' : ''}.mp4`);
  const previewPath = join(dir, `scene_${String(scene.idx).padStart(3, '0')}_preview.jpg`);
  const res = await renderScenePage({
    html, w, h, fps, duration,
    audioPath: scene.audio_path && existsSync(scene.audio_path) ? scene.audio_path : null,
    outPath, previewPath, onProgress, onLog,
  });
  if (overlayOn) {
    const { compositeColorkey } = await import('../media/ffmpeg.js');
    const finalPath = join(dir, `scene_${String(scene.idx).padStart(3, '0')}.mp4`);
    await compositeColorkey(res.path, config.overlay.source, finalPath, {
      start: progressStart || 0, duration: res.duration, w, h, fps,
      key: (config.overlay.key || '#050510').replace('#', '0x'),
    });
    return { ...res, path: finalPath, preview: existsSync(previewPath) ? previewPath : null };
  }
  return { ...res, preview: existsSync(previewPath) ? previewPath : null };
}

// (The synthetic "Cảm ơn đã xem" outro clip was removed — P31, owner order 2026-07-18:
// the video ends on the script's own closing-CTA scene, codegen'd like every other scene,
// exactly as the reference app does. cta-outro remains a normal TEMPLATE the animation-mode
// planner may pick for a narrated closing scene — content then comes from the script.)

// One preview frame (UI helper).
export async function previewSceneFrame(scene, project, config, { outPath, t } = {}) {
  const { w, h } = animSize(project.aspect_ratio, 1); // previews always 1080-class
  const duration = Math.max(1.5, scene.duration || config.sceneDuration || 6);
  const html = buildSceneHtml(scene, project, config, { durationOverride: duration, progressStart: 0, progressTotal: duration });
  return renderPreviewFrame(html, { w, h, t: t ?? duration / 2, outPath });
}
