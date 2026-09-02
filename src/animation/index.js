// High-level animation-mode API used by the pipeline runner and routes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenePage } from './harness.js';
import { buildTemplate, makeCtx } from './templates.js';
import { themeFromGuide, resolveGuide, normalizeGuide } from '../styleguide/index.js';
import { headline } from './planner.js';
import { beatWarpMap } from './timewarp.js';
import { renderScenePage, renderPreviewFrame } from './renderer.js';
import { probeImageSize } from '../media/ffmpeg.js';
import { resolveBrandKit, planBrandPlacement, buildBrandLayer, imgDataUri } from './branding.js';
import { captionStyleFrom, familyName } from '../subtitles/presets.js';
import { familyReady } from '../fonts/registry.js';
import { rechunkCues } from '../subtitles/chunk.js';
import { ratioToSize, hash32 } from '../util/util.js';
import { wordJoiner } from '../i18n/segment.js';
import { lang as langRow } from '../i18n/languages.js';
import { scriptFallback } from '../styleguide/script-fonts.js';

// Per-project seed salt (P31): scene N of two different videos must NOT share randomness
// (particles, ambient layout, FX picks) — before this, seed was `idx + 1` for every video,
// so same-index scenes came out near-identical across projects. Determinism per project is
// preserved (same project + idx → same seed forever); no project id → the legacy seed,
// byte-identical (previews, tests, harness runs without a real project).
export function sceneSeed(project, idx) {
  const base = (idx | 0) + 1;
  return project?.id ? ((hash32(String(project.id)) ^ base) >>> 0) : base;
}

export { resolveBrandKit };

// A scene with no stored plan resolves to the kinetic-statement fallback (the animation
// planner is gone with the animation visual mode): buildTemplate always renders it, so a
// legacy row whose stored template no longer exists still produces a complete frame.
function fallbackPlan(scene) {
  return { template: 'kinetic-statement', props: { pre: '', heading: headline(scene.voice_text || '', 40), heading2: '', sub: undefined } };
}

function resolveWatermark(config) {
  if (config?.logo?.path && existsSync(config.logo.path)) {
    const uri = imgDataUri(config.logo.path);
    if (uri) return { imageUri: uri };
  }
  const t = (config?.watermarkText ?? '').trim();
  return t ? { text: t } : null;
}

// The only viewport sizes the renderer builds: 1080p · 1440p · 4K. 4/3 lands exactly on
// 2560×1440 (and 1440×2560 vertical) — every ratio stays an integer, which h.264 requires.
const RUNGS = [1, 4 / 3, 2];

/** Snap a stored resolutionScale to the nearest supported rung. @param {number} scale */
export function resRung(scale) {
  const v = +scale || 1;
  return RUNGS.reduce((best, r) => (Math.abs(r - v) < Math.abs(best - v) ? r : best), 1);
}

export function animSize(aspectRatio, scale = 1) {
  const s = ratioToSize(aspectRatio);
  const k = resRung(scale);
  return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
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
    : fallbackPlan(scene);
  if (config.overlay?.enabled && plan.props && !plan.props.overlay) {
    plan = { ...plan, props: { ...plan.props, overlay: true } };
  }
  // HyperFrame scenes carry their style guide in props — the whole page (bg canvas, captions,
  // progress bar) follows the guide's palette instead of the classic theme. In a hyperframe
  // project the guide also drives FALLBACK-template scenes and the outro, so a scene that
  // dropped to the heuristic planner can never break the video's visual identity.
  // Single visual mode: every scene follows the video's style guide. A hyperframe scene
  // carries its own guide in props; the kinetic-statement fallback + chapter-break resolve
  // the project guide, so a fallback scene can never break the video's visual identity.
  let theme = plan.template === 'hyperframe' && plan.props?.guide
    ? themeFromGuide(normalizeGuide(plan.props.guide))
    : themeFromGuide(resolveGuide(config));
  ({ plan, theme } = applyBrandFont(plan, theme, config));
  // captions resolve BEFORE the template builds: word timings feed ctx.accentTimes so
  // template motion lands on the narration's beats (still deterministic — srt_json is data).
  // P29: display cues may be re-chunked (sentence / N-word) — a pure rebuild from the SAME
  // word timestamps, so subtitle timing stays glued to the voice; beats keep the raw cues.
  // On the FINAL lane the clip is rendered bare and the captions are burned onto the assembled
  // programme instead — that is what makes a subtitle edit cost one concat rather than one
  // render per scene. `ctx.captions` below is untouched either way: those word timings drive
  // template motion (accentTimes), not display, and zeroing them would change the animation.
  //
  // On the final lane the cues still ride into the page, as LAYOUT data only: `captionsOff`
  // removes the element that would draw them, while `__safeZone` and planBrandPlacement keep
  // reading `captions.length` to hold the bottom band clear. A clip that reserved no room for
  // subtitles could not receive them later without being re-rendered — which is the one thing
  // this lane exists to avoid. That is also why the reserve ignores `enableSubtitles` here:
  // turning captions on or off must stay a concat-level decision, and it cannot be that if it
  // changes the picture underneath.
  const finalLane = config.subtitleLane === 'final';
  const captions = finalLane || config.enableSubtitles !== false
    ? rechunkCues(scene.srt_json || [], {
      chunk: config.subtitleChunk, wordsPerCue: config.subtitleWordsPerCue, text: scene.voice_text,
      lang: config.subtitleLang || config.language,
    })
    : [];
  const ctx = makeCtx({ w, h, theme, seed: sceneSeed(project, scene.idx), duration, idx: scene.idx, captions: scene.srt_json || [],
    script: langRow(config.subtitleLang || config.language).script });
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
    captionsOff: finalLane,
    // Scene hand-off: the clip's content leaves before the cut and arrives just after it, so the
    // join blends an empty frame against an arriving one instead of superimposing two full ones.
    // The key is named `hyperframeHandoff` on purpose — RENDER_CFG_KEYS matches `^hyperframe`, so
    // turning it on invalidates the clips it changes. A name that did not match would leave a
    // video silently mixing ramped and un-ramped clips with no way to tell.
    handoff: config.hyperframeHandoff === true,
    // sentence cues run long — let the caption wrap to 2 lines instead of shrinking to dust
    capWrap: config.subtitleChunk === 'sentence',
    capJoin: wordJoiner(config.subtitleLang || config.language),
    // P30 loud-font contract: the page probes these families after load; a miss surfaces
    // in __init's return so the renderer can warn instead of silently substituting.
    // P30 loud-font contract, plus the script's own face: the page probes these after load and a
    // miss surfaces in __init's return, so the renderer warns instead of silently substituting.
    // Without the third entry a Thai or Devanagari video substituted in total silence.
    fontChecks: [familyName(config.subtitleFont), familyName(config.fonts?.display),
      (scriptFallback(config.subtitleLang || config.language)[0] || '').replace(/'/g, '')].filter(Boolean),
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
// .hf-kw/.hf-kw2/.hf-stat-v); the kinetic-statement / chapter-break fallbacks through theme.font.
export function brandFontStack(config) {
  const fam = String(config?.fonts?.display || '').replace(/['"<>]/g, '').trim();
  return fam ? `'${fam}', 'Be Vietnam Pro', sans-serif` : null;
}
function applyBrandFont(plan, theme, config) {
  const stack = brandFontStack(config);
  if (!stack) return { plan, theme };
  if (plan.props?.guide) {
    plan = { ...plan, props: { ...plan.props, guide: { ...plan.props.guide, fonts: { ...(plan.props.guide.fonts || {}), display: stack } } } };
  } else {
    // fallback templates (kinetic-statement / chapter-break) carry no guide — put the brand
    // display font on the theme instead, so they still match the channel's typography.
    theme = { ...theme, font: stack };
  }
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
  let plan = scene.template && scene.props
    ? { template: scene.template, props: scene.props }
    : fallbackPlan(scene);
  let theme = plan.template === 'hyperframe' && plan.props?.guide
    ? themeFromGuide(normalizeGuide(plan.props.guide))
    : themeFromGuide(resolveGuide(config));
  ({ plan, theme } = applyBrandFont(plan, theme, config));
  const ctx = makeCtx({ w, h, theme, seed: sceneSeed(project, scene.idx), duration, idx: scene.idx, captions: scene.srt_json || [],
    script: langRow(config.subtitleLang || config.language).script });
  const tpl = buildTemplate(plan.template, plan.props, ctx);
  applyCustomOverride(tpl, plan.props);
  return { template: plan.template, html: tpl.html || '', css: tpl.css || '', script: tpl.script || '', hasCustom: !!plan.props?.__custom };
}

// Render a full scene → mp4 (+ mid-frame preview jpeg). In overlay mode the keyed scene
// then composites onto the owner's base footage (slice offset = the scene's start on the
// final timeline, so consecutive scenes ride one continuous shot).
export async function renderAnimationScene(scene, project, config, { dir, progressStart, progressTotal, total, onProgress, onLog } = {}) {
  const k = resRung(config.resolutionScale);
  const { w, h } = animSize(project.aspect_ratio, k); // PHYSICAL viewport (2560×1440 at 4/3, 4K at 2)
  const fps = parseInt(config.fps || 30, 10);
  const duration = Math.max(1.5, scene.duration || config.sceneDuration || 6);
  // A family the owner NAMED has to exist before a single frame is drawn. Chrome substitutes
  // silently, so the alternative is 95 clips in the wrong typeface discovered by eye — the same
  // failure mode the burn path refuses, refused here too. Only explicit picks are fatal; a font
  // the codegen model invented inside its own CSS surfaces as a warning from the render itself.
  for (const [label, family] of [['phụ đề', config.subtitleFont], ['chữ đồ hoạ', config.fonts?.display]]) {
    const fam = familyName(family);
    if (fam && !familyReady(fam)) {
      throw new Error(
        `font ${label} "${fam}" chưa có trên máy — Chrome sẽ thay bằng font khác mà không báo. `
        + 'Vào Thư viện → Font chữ để tải về, hoặc chọn font khác.',
      );
    }
  }
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
    // Edit-video mode (P40): the scenes were cut FROM this footage, so each one composites onto
    // its exact source moment and keeps the original soundtrack. Plain overlay mode keeps the
    // historic behaviour — a wrapping slice of B-roll under a narrated scene.
    const edit = config.overlay.mode === 'edit';
    await compositeColorkey(res.path, config.overlay.source, finalPath, {
      start: progressStart || 0, duration: res.duration, w, h, fps,
      key: (config.overlay.key || '#050510').replace('#', '0x'),
      exact: edit, audioFrom: edit ? 'footage' : 'scene',
      // P43: where the subject sits when the footage has to be cropped to the project ratio
      position: config.overlay.position || 'center',
      // P44: a slow push-in/pull-out on the footage, alternating direction per scene so a long
      // stretch of one static shot never sits perfectly still. Off unless the owner asks.
      zoom: config.overlay.zoom ? { ...config.overlay.zoom, index: scene.idx } : null,
    });
    return { ...res, path: finalPath, preview: existsSync(previewPath) ? previewPath : null };
  }
  // A clip whose pixels do not match the size that was asked for is a silent downgrade: it
  // survives the join, ships, and is only visible in ffprobe. It cost a whole render pass once.
  const got = await probeImageSize(res.path);
  if (got && (got.w !== w || got.h !== h)) {
    throw new Error(`cảnh ${scene.idx + 1}: kích thước không khớp — yêu cầu ${w}×${h}, nhận ${got.w}×${got.h}`);
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
