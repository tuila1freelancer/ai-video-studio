// Pipeline orchestration: B2 script → B3+4 TTS/SRT → B5 visuals → B6 render → B7 concat/mix.
import { writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { logger } from '../util/log.js';
import { DIRS } from '../config/paths.js';
import { ratioToSize } from '../util/util.js';
import { generateScript, generateMetadata, llmEnabled } from '../providers/llm.js';
import { generateDirections, generateSceneDirection, hasDirection } from './direction.js';
import { synthesizeVoice } from '../providers/tts.js';
import { buildSubtitles } from '../providers/subtitle.js';
import { fetchLink } from '../providers/fetchlink.js';
import { imageGenEnabled } from '../providers/imagegen.js';
import { planScenes, planScene, renderAnimationScene, renderOutroScene, previewSceneFrame, resolveBrandKit, animSize } from '../animation/index.js';
import { generateSceneSpec } from '../hyperframe/codegen.js';
import { resolveGuide } from '../styleguide/index.js';
import { headline } from '../animation/planner.js';
import { buildSceneBackground, buildThumbnail } from './visuals.js';
import { renderScene, concatScenes, renderCard } from './render.js';
import { qcFinalVideo, qcSceneClip } from './qc.js';
import { makeAmbientBed, probeDuration, normalizeVoice, makeWhoosh, makeSfxBed } from '../media/ffmpeg.js';
import { detectLang } from '../util/lang.js';
import { buildSrt } from './srt.js';
import { withRetry, sleep } from '../util/retry.js';
import { aiSettingsFor, ttsOverrideFor } from '../core/config.js';
import { requestStop, clearStop, checkStop, notStopped, isStopped } from './stop.js';
import { step, op, retryHook, progressPlan } from './progress.js';
import { mapPool, resolveOutputDir, visualOpts, subtitleStyleFrom } from './helpers.js';

// re-exported so pipeline/queue.js keeps its stable import surface
export { requestStop, clearStop };

export async function runPipeline(projectId, { resume = false, _auto = 0 } = {}) {
  clearStop(projectId);
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const config = project.config || {};
  const size = ratioToSize(project.aspect_ratio);
  const dir = DB.projectDirFor(projectId);
  const channel = DB.channelOf(projectId);
  const ai = aiSettingsFor(channel); // per-channel AI overrides (llm/tts/subtitle/imageGen)
  project.outputDir = resolveOutputDir(projectId, config, dir);

  DB.updateProject(projectId, { status: 'running', error: null });
  hub.toProject(projectId, { type: 'status', status: 'running' });

  try {
    // ---- B2: SCRIPT ----
    let scenes = DB.getScenes(projectId);
    if (!resume || scenes.length === 0) {
      step(projectId, 'b2', 'running', 'Tạo kịch bản');
      DB.updateProject(projectId, { current_step: 'b2' });
      op(projectId, 'Đang tạo kịch bản…');
      let fetched = null;
      if (project.input_type === 'url') {
        try { fetched = await fetchLink(project.topic.trim().split(/\s+/)[0]); } catch (e) { logger.warn(`fetch-link: ${e.message}`, { projectId }); }
      }
      const script = await withRetry(
        () => generateScript({ topic: project.topic, inputType: project.input_type, fetched, config, ai }),
        { tries: 2, label: 'b2 script', onRetry: retryHook(projectId, 'b2'), fatal: notStopped },
      );
      project.title = (script.title || project.title || '').trim() || project.title;
      DB.updateProject(projectId, { title: project.title });
      scenes = DB.replaceScenes(projectId, script.scenes);
      logger.info(`Script: ${scenes.length} scenes`, { projectId });
      step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
    } else {
      step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
    }
    checkStop(projectId);

    // ---- B3+4: TTS + SRT ----
    step(projectId, 'b34', 'running', 'Lồng tiếng + phụ đề');
    DB.updateProject(projectId, { current_step: 'b34' });
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
      const padMs = lang === 'vi' ? 650 : 400;
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

    // ---- B5: VISUALS ----
    const visualMode = config.visualMode || 'animation';
    scenes = DB.getScenes(projectId);
    if (visualMode === 'animation') {
      // Animation mode: assign a motion template + props per scene (no image downloads).
      // Backfill-only: scenes that already carry a plan (B2 two-stage, resume, user edits) keep it.
      step(projectId, 'b5', 'running', 'Chọn template animation');
      DB.updateProject(projectId, { current_step: 'b5' });
      op(projectId, '🎬 Lên bố cục motion-graphics…');
      const needPlan = scenes.some((sc) => !(sc.template && sc.props));
      const plans = needPlan
        ? await withRetry(() => planScenes(scenes, { title: project.title, brand: resolveBrandKit(config), ai }),
          { tries: 2, label: 'b5 plan', onRetry: retryHook(projectId, 'b5'), fatal: notStopped })
        : null;
      scenes.forEach((sc, i) => {
        if (sc.template && sc.props) return;
        DB.updateScene(sc.id, { template: plans[i].template, props: plans[i].props, status: 'html' });
        hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: plans[i].template });
      });
    } else if (visualMode === 'hyperframe') {
      // HyperFrame: the LLM art-directs each scene's graphics against the REAL voice timeline
      // (beats from srt_json word timestamps). Bad/failed specs fall back to the heuristic
      // planner so the pipeline always completes.
      step(projectId, 'b5', 'running', 'AI đạo diễn visual từng cảnh');
      DB.updateProject(projectId, { current_step: 'b5' });
      op(projectId, '✨ HyperFrame: AI dàn dựng đồ hoạ theo lời thoại…');
      const guide = resolveGuide(config);
      const hfSize = animSize(project.aspect_ratio, config.resolutionScale || 1);
      const totalHf = scenes.length;
      // optional per-video model override for the codegen step (a stronger model → nicer scenes);
      // modelFallback rides along so a rate-limited strong model degrades to a decent one
      // instead of dropping the scene to a heuristic template.
      const hfAi = config.hyperframe?.model && ai?.llm
        ? { ...ai, llm: { ...ai.llm, model: config.hyperframe.model,
            ...(config.hyperframe.modelFallback ? { modelFallback: config.hyperframe.modelFallback } : {}) } }
        : ai;
      // Art-director pass: write a structured cinematic brief per scene BEFORE codegen —
      // long videos otherwise carry only a truncated voice snippet as their visual concept.
      // Skips scenes that already have one (resume / user edits); failure keeps the old brief.
      const undirected = scenes.filter((sc) => !hasDirection(sc)
        && !(sc.template === 'hyperframe' && sc.props?.script)
        && !(sc.template === 'chapter-break' && sc.props));
      if (undirected.length && llmEnabled(hfAi?.llm)) {
        op(projectId, `🎬 AI viết chỉ đạo hình ảnh ${undirected.length} cảnh…`);
        const dirs = await generateDirections(undirected, {
          title: project.title, total: totalHf, guide, ai: hfAi, language: config.language,
          onLog: (m) => logger.info(m, { projectId }),
        });
        for (const sc of undirected) {
          const d = dirs.get(sc.idx);
          if (!d) continue;
          DB.updateScene(sc.id, { visual_prompt: d.visual });
          sc.visual_prompt = d.visual;
        }
        logger.info(`direction pass: ${dirs.size}/${undirected.length} cảnh`, { projectId });
      }
      const hookVisual = scenes[0]?.visual_prompt || '';
      // Concurrency 2: each codegen now also renders (renderValidate) on the shared headless
      // browser — 2 keeps throughput up without thrashing Chrome with too many parallel pages.
      await mapPool(scenes, 2, async (sc) => {
        checkStop(projectId);
        if (sc.template === 'hyperframe' && sc.props?.script) return; // resume / user-kept spec
        // chapter-break cards stay as-is: they render on the guide theme (one visual identity),
        // keep the channel's section-title punch, and anchor the transition SFX bed.
        if (sc.template === 'chapter-break' && sc.props) return;
        op(projectId, `🎨 AI dựng cảnh ${sc.idx + 1}/${totalHf}`);
        try {
          const { props, beats } = await generateSceneSpec({
            scene: sc, guide, w: hfSize.w, h: hfSize.h, idx: sc.idx, total: totalHf, ai: hfAi,
            density: config.hyperframe?.density, creativeDirection: config.hyperframe?.direction,
            hookVisual: sc.idx > 0 ? hookVisual : '',
            onLog: (m) => logger.warn(m, { projectId }),
          });
          // clear any stale clip: on resume a scene that just got FRESH visuals must re-render
          DB.updateScene(sc.id, { template: 'hyperframe', props, status: 'html', video_path: null });
          hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: 'hyperframe', beats: beats.length });
        } catch (e) {
          if (e.stopped) throw e;
          logger.warn(`hyperframe scene ${sc.idx}: ${e.message} — fallback heuristic template`, { projectId });
          hub.toProject(projectId, { type: 'retry', scope: 'scene', step: 'b5', idx: sc.idx, attempt: 1, msg: e.message });
          op(projectId, `🩹 Cảnh ${sc.idx + 1}: AI visual lỗi — dùng template dự phòng`);
          const plan = planScene(sc, { idx: sc.idx, total: totalHf, title: project.title, brand: resolveBrandKit(config) });
          DB.updateScene(sc.id, { template: plan.template, props: plan.props, status: 'html' });
          hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: plan.template });
        }
      });
    } else {
      step(projectId, 'b5', 'running', 'Tạo ảnh AI + dựng cảnh');
      DB.updateProject(projectId, { current_step: 'b5' });
      // Sequential image generation — concurrent requests get throttled by the free image API.
      const b5c = imageGenEnabled() && config.richAnimation !== false ? 1 : 4;
      await mapPool(scenes, b5c, async (sc) => {
        checkStop(projectId);
        if (resume && sc.image_path && existsSync(sc.image_path)) return;
        op(projectId, `🎨 Dựng cảnh ${sc.idx + 1}/${scenes.length}`);
        const bg = await buildSceneBackground(sc, project, size, visualOpts(config, dir));
        DB.updateScene(sc.id, { image_path: bg, status: 'html' });
        hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', image: `/api/file?path=${encodeURIComponent(bg)}` });
      });
    }
    step(projectId, 'b5', 'done');
    checkStop(projectId);

    // ---- B6: RENDER scenes (self-healing) ----
    const animLike = visualMode !== 'image'; // animation + hyperframe share the GSAP renderer
    step(projectId, 'b6', 'running', animLike ? 'Render animation từng frame' : 'Render cảnh');
    DB.updateProject(projectId, { current_step: 'b6' });
    scenes = DB.getScenes(projectId);
    const subtitleStyle = subtitleStyleFrom(config);
    const rC = animLike
      ? parseInt(config.renderConcurrency || 3, 10)
      : (config.parallelRender ? parseInt(config.renderConcurrency || 2, 10) : 1);
    const pp = progressPlan(scenes, config);

    const renderSceneOnce = async (sc) => {
      let path, duration, preview = null;
      if (animLike) {
        const r = await renderAnimationScene(sc, project, config, {
          dir: join(dir, 'render'), progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: scenes.length,
          onProgress: (f) => { if (f >= 0.999 || Math.round(f * 4) !== Math.round((f - 0.01) * 4)) op(projectId, `🎬 Cảnh ${sc.idx + 1}/${scenes.length} · ${(f * 100).toFixed(0)}%`); },
        });
        path = r.path; duration = r.duration; preview = r.preview;
      } else {
        const r = await renderScene(sc, project, {
          dir: join(dir, 'render'), size, subtitleStyle, renderMode: config.renderMode,
          onLog: (s) => logger.debug(s, { projectId }),
        });
        path = r.path; duration = r.duration;
      }
      DB.updateScene(sc.id, { video_path: path, duration, status: 'rendered', error: null, ...(preview ? { image_path: preview } : {}) });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'rendered',
        video: `/api/file?path=${encodeURIComponent(path)}`, ...(preview ? { image: `/api/file?path=${encodeURIComponent(preview)}` } : {}) });
    };
    // Layered self-heal: renderer retries internally → swap to the bulletproof fallback
    // template → deferred sequential retry at the end. The whole run only fails if a scene
    // still cannot render alone on a quiet machine.
    const renderHealed = async (sc) => {
      try { await renderSceneOnce(sc); return; }
      catch (e) {
        if (e.stopped) throw e;
        logger.warn(`scene ${sc.idx} render failed: ${e.message} — self-heal`, { projectId });
        hub.toProject(projectId, { type: 'retry', scope: 'scene', step: 'b6', idx: sc.idx, attempt: 1, msg: e.message });
        if (animLike && sc.template !== 'kinetic-statement') {
          op(projectId, `🩹 Cảnh ${sc.idx + 1}: đổi template dự phòng rồi thử lại…`);
          DB.updateScene(sc.id, { template: 'kinetic-statement', props: {
            pre: '', heading: headline(sc.voice_text || '', 40), heading2: '', sub: undefined,
          } });
          sc = DB.getScene(sc.id);
        } else {
          op(projectId, `🩹 Cảnh ${sc.idx + 1}: thử lại…`);
        }
        await renderSceneOnce(sc);
      }
    };

    const failedScenes = [];
    await mapPool(scenes, rC, async (sc) => {
      checkStop(projectId);
      if (resume && sc.video_path && existsSync(sc.video_path)) return;
      op(projectId, `🎬 Render cảnh ${sc.idx + 1}/${scenes.length}`);
      try { await renderHealed(sc); }
      catch (e) {
        if (e.stopped) throw e;
        failedScenes.push(sc.id);
        DB.updateScene(sc.id, { status: 'error', error: e.message });
        hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'error', error: e.message });
      }
    });
    // Deferred pass: retry stragglers one-by-one (no concurrency → no CPU contention).
    if (failedScenes.length) {
      op(projectId, `🩹 Thử lại ${failedScenes.length} cảnh lỗi (tuần tự)…`);
      for (const sid of failedScenes) {
        checkStop(projectId);
        await renderHealed(DB.getScene(sid));
      }
    }
    // Verify & repair: every scene clip must exist, probe sane, carry BOTH streams (a silent
    // scene is a defect, never shipped) and match its voice duration.
    op(projectId, '🔍 Kiểm tra chất lượng từng cảnh…');
    for (const sc of DB.getScenes(projectId)) {
      checkStop(projectId);
      const check = sc.video_path && existsSync(sc.video_path)
        ? await qcSceneClip(sc.video_path, { expectDur: sc.duration || 0 })
        : { ok: false, reason: 'file thiếu' };
      if (!check.ok) {
        op(projectId, `🩹 Cảnh ${sc.idx + 1}: ${check.reason} — render lại…`);
        logger.warn(`scene ${sc.idx} failed verification (${check.reason}) — re-rendering`, { projectId });
        await renderHealed(sc);
      }
    }
    step(projectId, 'b6', 'done');
    checkStop(projectId);

    // ---- B7: CONCAT + MIX ----
    if (config.autoConcat !== false) {
      await finalize(projectId, { dir, size, config });
    }

    // ---- Metadata (auto, no manual step) ----
    if (config.generateMetadata !== false) {
      try {
        op(projectId, '📊 Tạo metadata…');
        const md = await withRetry(() => generateMetadata(DB.getProject(projectId), null, { ai }),
          { tries: 2, label: 'metadata', fatal: notStopped });
        // YouTube chapters from scene offsets (≤ 14 markers, first at 00:00)
        const scs = DB.getScenes(projectId);
        const every = Math.max(1, Math.ceil(scs.length / 14));
        let acc = 0; const chapters = [];
        for (const sc of scs) {
          if (sc.idx % every === 0) {
            const mm = Math.floor(acc / 60), ss = Math.floor(acc % 60);
            const label = (sc.props && sc.props.heading) || (sc.voice_text || '').split(/[,.!?…]/)[0].slice(0, 48);
            chapters.push(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} ${label}`);
          }
          acc += Math.max(1.5, sc.duration || config.sceneDuration || 6);
        }
        md.chapters = chapters;
        md.description = `${md.description || ''}\n\n📑 Chương:\n${chapters.join('\n')}`.trim();
        DB.updateProject(projectId, { metadata: md });
      } catch (e) { logger.warn(`metadata: ${e.message}`, { projectId }); }
    }

    DB.updateProject(projectId, { status: 'done' });
    const fin = DB.getProject(projectId);
    hub.toProject(projectId, { type: 'done', video: fin.video_path ? `/api/file?path=${encodeURIComponent(fin.video_path)}` : null,
      thumb: fin.thumb_path ? `/api/file?path=${encodeURIComponent(fin.thumb_path)}` : null });
    logger.info('Pipeline done', { projectId });
  } catch (e) {
    if (e.stopped) {
      DB.updateProject(projectId, { status: 'paused' });
      hub.toProject(projectId, { type: 'status', status: 'paused' });
      logger.warn('Pipeline stopped', { projectId });
    } else if (_auto < 1) {
      // Macro self-heal: one automatic resume — completed work is on disk/DB, so this
      // only redoes the failing part. Only after that do we surface an error.
      logger.warn(`Pipeline error: ${e.message} — auto-resume in 8s`, { projectId });
      hub.toProject(projectId, { type: 'retry', scope: 'pipeline', attempt: 1, msg: e.message, delayMs: 8000 });
      op(projectId, `🩹 Gặp lỗi "${e.message.slice(0, 100)}" — tự động chạy tiếp sau 8 giây…`);
      await sleep(8000);
      if (!isStopped(projectId)) return runPipeline(projectId, { resume: true, _auto: _auto + 1 });
      DB.updateProject(projectId, { status: 'paused' });
      hub.toProject(projectId, { type: 'status', status: 'paused' });
    } else {
      DB.updateProject(projectId, { status: 'error', error: e.message });
      hub.toProject(projectId, { type: 'error', msg: e.message });
      logger.error(`Pipeline error: ${e.message}`, { projectId });
    }
  } finally {
    clearStop(projectId);
  }
}

async function finalize(projectId, { dir, size, config, _qcAttempt = 0 }) {
  step(projectId, 'b7', 'running', 'Ghép & mix');
  DB.updateProject(projectId, { current_step: 'b7' });
  const project = DB.getProject(projectId);
  project.outputDir = resolveOutputDir(projectId, config, dir);
  const renderDir = join(dir, 'render');
  const all = DB.getScenes(projectId).sort((a, b) => a.idx - b.idx);
  const missing = all.filter((s) => !(s.video_path && existsSync(s.video_path)));
  if (missing.length && (config.visualMode || 'animation') !== 'image') {
    // Never silently drop scenes from the final cut — repair them here.
    op(projectId, `🩹 ${missing.length} cảnh thiếu clip — render bù trước khi ghép…`);
    logger.warn(`finalize: ${missing.length} scenes missing clips — repairing`, { projectId });
    const pp = progressPlan(all, config);
    for (const sc of missing) {
      const r = await renderAnimationScene(sc, project, config, {
        dir: renderDir, progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: all.length,
      });
      DB.updateScene(sc.id, { video_path: r.path, duration: r.duration, status: 'rendered', error: null });
    }
  } else if (missing.length) {
    logger.warn(`finalize: ${missing.length} scenes missing clips (image mode) — concatenating the rest`, { projectId });
  }
  const scenes = DB.getScenes(projectId).filter((s) => s.video_path && existsSync(s.video_path)).sort((a, b) => a.idx - b.idx);
  let clips = scenes.map((s) => s.video_path);
  const firstImg = scenes.find((s) => s.image_path && existsSync(s.image_path))?.image_path;
  const lastImg = [...scenes].reverse().find((s) => s.image_path && existsSync(s.image_path))?.image_path;

  // Intro / outro
  const visualMode = config.visualMode || 'animation';
  if (visualMode !== 'image') {
    // intro = scene 0's hero-title template (already narrated); only a short outro is appended
    if (config.outro !== false) {
      op(projectId, '🎬 Tạo outro…');
      const pp = progressPlan(scenes, config);
      const o = await renderOutroScene(project, config, { dir: renderDir, progressStart: pp.outroStart, progressTotal: pp.total, duration: 2.6 });
      clips = [...clips, o.path];
    }
  } else {
    if (config.intro !== false) {
      op(projectId, '🎬 Tạo intro…');
      clips = [await renderCard(project.title, 'AI VIDEO STUDIO', { dir: renderDir, size, bgImage: firstImg, duration: 2.6, idx: 'intro' }), ...clips];
    }
    if (config.outro !== false) {
      op(projectId, '🎬 Tạo outro…');
      clips = [...clips, await renderCard('Cảm ơn đã xem ❤', 'Theo dõi để xem thêm', { dir: renderDir, size, bgImage: lastImg, duration: 2.4, idx: 'outro' })];
    }
  }

  // Image mode: brand-kit logo maps onto the legacy whole-video overlay. Animation/hyperframe
  // must NOT get this — their brand layer is already composited into every scene page.
  if (visualMode === 'image' && config.brandKit?.logo?.assetPath && !config.logo?.path) {
    const bl = config.brandKit.logo;
    config.logo = { path: bl.assetPath, size: Math.round((bl.sizePct || 8.5) * 10.8), position: bl.position };
  }

  // BGM: user-selected file, else an auto ambient bed (cached per project)
  let bgmPath = null;
  if (config.bgmPath && existsSync(config.bgmPath)) bgmPath = config.bgmPath;
  else if (config.autoBgm !== false) {
    op(projectId, '🎵 Tạo nhạc nền…');
    bgmPath = join(renderDir, 'bgm_bed.m4a');
    if (!existsSync(bgmPath)) { try { await makeAmbientBed(bgmPath, 45); } catch { bgmPath = null; } }
  }

  op(projectId, '✂️ Ghép & mix…');
  const expectDur = scenes.reduce((a, s) => a + (s.duration || 0), 0);

  // SFX: a whoosh on every chapter transition — the section punctuation that makes long
  // videos feel edited, not concatenated. Synthesized offline; any failure just skips SFX.
  let sfxPath = null;
  if (config.autoSfx !== false && visualMode !== 'image' && expectDur > 0) {
    let t = 0; const events = [];
    for (const s of scenes) { if (s.template === 'chapter-break' && t > 0.5) events.push({ at: t }); t += s.duration || 0; }
    if (events.length) {
      try {
        op(projectId, `🔊 Đặt ${events.length} SFX chuyển chương…`);
        const whoosh = join(renderDir, 'sfx_whoosh.m4a');
        if (!existsSync(whoosh)) await makeWhoosh(whoosh);
        sfxPath = await makeSfxBed(join(renderDir, 'sfx_bed.m4a'), { events, whooshPath: whoosh, total: expectDur });
      } catch (e) { logger.warn(`sfx bed: ${e.message} — bỏ SFX`, { projectId }); sfxPath = null; }
    }
  }

  const res = await withRetry(async () => {
    const r = await concatScenes(clips, project, {
      dir: renderDir, size, bgmPath, sfxPath, logo: config.logo,
      transitions: config.transitions === true, onLog: (s) => logger.debug(s, { projectId }),
    });
    // Output must exist and cover the scene material (10% tolerance + transition losses).
    const got = await probeDuration(r.path);
    if (!got || got < Math.max(1, expectDur * 0.88 - 4)) {
      throw new Error(`video ghép ngắn bất thường (${Math.round(got || 0)}s / kỳ vọng ~${Math.round(expectDur)}s)`);
    }
    return r;
  }, { tries: 2, label: 'b7 concat', onRetry: retryHook(projectId, 'b7') });

  // ---- B8: content quality gate — decode the finished video and hunt visible defects
  // (black frames, dead air, missing audio). Scene-attributable defects get ONE repair
  // cycle: re-render exactly those scenes, then concat + QC again. The report always
  // lands in qc_report.json so a run is never silently "done" with known defects.
  if (config.qcGate !== false) {
    op(projectId, '🔬 QC video thành phẩm (black-frame / khoảng câm / thời lượng)…');
    let t0 = 0;
    const sceneSpans = scenes.map((s) => { const span = { idx: s.idx, t0, t1: t0 + (s.duration || 0) }; t0 = span.t1; return span; });
    // expected FINAL duration = scene material + intro/outro cards − xfade overlaps
    const outroDur = visualMode !== 'image'
      ? (config.outro !== false ? 2.6 : 0)
      : (config.intro !== false ? 2.6 : 0) + (config.outro !== false ? 2.4 : 0);
    const xfadeLoss = config.transitions === true && clips.length > 1 && clips.length <= 24 ? 0.5 * (clips.length - 1) : 0;
    const qc = await qcFinalVideo(res.path, { expectDur: expectDur + outroDur - xfadeLoss, sceneSpans, tolerancePct: 8, tailAllowance: outroDur });
    writeFileSync(join(dir, 'qc_report.json'), JSON.stringify({ ...qc, at: new Date().toISOString(), attempt: _qcAttempt }, null, 2));
    if (!qc.ok) {
      const badIdx = [...new Set(qc.issues.map((i) => i.sceneIdx).filter((n) => n != null))];
      logger.warn(`QC: ${qc.issues.length} vấn đề (${qc.issues.map((i) => i.type).join(', ')}) — cảnh liên quan: ${badIdx.join(', ') || 'không xác định'}`, { projectId });
      if (badIdx.length && _qcAttempt < 1 && visualMode !== 'image') {
        op(projectId, `🩹 QC phát hiện lỗi ở ${badIdx.length} cảnh — render lại và ghép lại…`);
        const pp2 = progressPlan(all, config);
        for (const idx of badIdx) {
          const sc = all.find((s) => s.idx === idx);
          if (!sc) continue;
          const r2 = await renderAnimationScene(DB.getScene(sc.id), project, config, {
            dir: renderDir, progressStart: pp2.offsets[sc.idx] || 0, progressTotal: pp2.total, total: all.length,
          });
          DB.updateScene(sc.id, { video_path: r2.path, duration: r2.duration, status: 'rendered', error: null });
        }
        return finalize(projectId, { dir, size, config, _qcAttempt: 1 });
      }
      op(projectId, `⚠️ QC còn ${qc.issues.length} cảnh báo (xem qc_report.json) — video vẫn được xuất`);
    } else {
      op(projectId, '✅ QC đạt: không black-frame, không khoảng câm, thời lượng khớp');
    }
  }

  // Premium thumbnail (title over best image); keyed to the video's style guide in
  // hyperframe mode so it matches the video. Falls back to the basic frame grab.
  let thumb = res.thumb;
  try {
    const guide = visualMode === 'hyperframe' ? resolveGuide(config) : null;
    const t = await buildThumbnail(project.title, firstImg, size, join(project.outputDir, `thumb_${Date.now()}.jpg`), { guide });
    if (t) thumb = t;
  } catch { /* keep basic */ }

  DB.updateProject(projectId, { video_path: res.path, thumb_path: thumb, current_step: 'b7' });
  step(projectId, 'b7', 'done', `${Math.round(res.duration)}s`);
  return res;
}

// Render entry used by /render (mode: all | scenes | concat)
export async function renderOnly(projectId, { mode = 'all', sceneIds = [] }) {
  clearStop(projectId);
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const config = project.config || {};
  const size = ratioToSize(project.aspect_ratio);
  const dir = DB.projectDirFor(projectId);
  DB.updateProject(projectId, { status: 'running' });
  hub.toProject(projectId, { type: 'status', status: 'running' });
  try {
    step(projectId, 'b6', 'running', 'Render');
    const visualMode = config.visualMode || 'animation';
    const allScenes = DB.getScenes(projectId);
    let scenes = allScenes;
    if (mode === 'scenes' && sceneIds.length) scenes = scenes.filter((s) => sceneIds.includes(s.id));
    const subtitleStyle = subtitleStyleFrom(config);
    const animLike = visualMode !== 'image';
    const rC = animLike
      ? parseInt(config.renderConcurrency || 3, 10)
      : (config.parallelRender ? parseInt(config.renderConcurrency || 2, 10) : 1);
    const pp = progressPlan(allScenes, config);
    await mapPool(scenes, rC, async (sc) => {
      checkStop(projectId);
      op(projectId, `🎬 Render cảnh ${sc.idx + 1}`);
      let path, duration, preview = null;
      if (animLike) {
        const r = await renderAnimationScene(sc, project, config, {
          dir: join(dir, 'render'), progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: allScenes.length,
        });
        path = r.path; duration = r.duration; preview = r.preview;
      } else {
        if (!sc.image_path || !existsSync(sc.image_path)) {
          sc.image_path = await buildSceneBackground(sc, project, size, visualOpts(config, dir));
          DB.updateScene(sc.id, { image_path: sc.image_path });
        }
        const r = await renderScene(sc, project, { dir: join(dir, 'render'), size, subtitleStyle, renderMode: config.renderMode });
        path = r.path; duration = r.duration;
      }
      DB.updateScene(sc.id, { video_path: path, duration, status: 'rendered', ...(preview ? { image_path: preview } : {}) });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'rendered', video: `/api/file?path=${encodeURIComponent(path)}`, ...(preview ? { image: `/api/file?path=${encodeURIComponent(preview)}` } : {}) });
    });
    step(projectId, 'b6', 'done');
    if (mode !== 'scenes') await finalize(projectId, { dir, size, config });
    DB.updateProject(projectId, { status: 'done' });
    const fin = DB.getProject(projectId);
    hub.toProject(projectId, { type: 'done', video: fin.video_path ? `/api/file?path=${encodeURIComponent(fin.video_path)}` : null,
      thumb: fin.thumb_path ? `/api/file?path=${encodeURIComponent(fin.thumb_path)}` : null });
  } catch (e) {
    if (e.stopped) { DB.updateProject(projectId, { status: 'paused' }); hub.toProject(projectId, { type: 'status', status: 'paused' }); }
    else { DB.updateProject(projectId, { status: 'error', error: e.message }); hub.toProject(projectId, { type: 'error', msg: e.message }); }
  } finally { clearStop(projectId); }
}

// Regenerate one scene's voice (B3+4) or visual (B5).
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

// Brand-asset generation (offline fallback: tinted variation posters from the reference).
export async function brandGenImpl(body, file) {
  const name = (body.charName || 'character').replace(/[^\w]/g, '') || 'character';
  const styleText = body.style || '2D Anime style';
  const emotions = ['happy', 'sad', 'angry', 'surprised', 'thinking', 'confident'];
  const brand = body.brand || name;
  const dir = join(DIRS.brand, brand);
  (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const items = [];
  for (let i = 0; i < emotions.length; i++) {
    const out = join(dir, `${name}_${emotions[i]}_${Date.now()}.png`);
    const sc = { idx: i, keywords: [emotions[i]], visual_prompt: `${name} — ${emotions[i]} (${styleText})` };
    const bg = await buildSceneBackground(sc, { title: name }, { w: 768, h: 768 }, { dir, mode: 'html' });
    if (existsSync(bg)) { copyFileSync(bg, out); }
    const lib = DB.addLibrary({ kind: 'brand', brandFolder: brand, name: `${name}_${emotions[i]}.png`, filename: `${name}_${emotions[i]}.png`, path: out, size: 0 });
    items.push(lib);
  }
  return { items, brand, note: 'Offline placeholder set. Cấu hình API tạo ảnh để có nhân vật thật.' };
}
