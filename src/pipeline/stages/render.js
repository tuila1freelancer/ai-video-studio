// B6 — RENDER scenes with layered self-heal (P10). Each clip is rendered, healed on failure
// (renderer retry → swap to the bulletproof kinetic-statement template → deferred sequential
// retry), then verified (P6): every clip must exist, probe sane, carry both streams and match
// its voice duration, else it is re-rendered.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { renderAnimationScene } from '../../animation/index.js';
import { headline } from '../../animation/planner.js';
import { renderScene } from '../render.js';
import { qcSceneClip } from '../qc.js';
import { checkStop } from '../stop.js';
import { step, op, progressPlan } from '../progress.js';
import { mapPool, subtitleStyleFrom } from '../helpers.js';
import { renderFingerprint, fpCurrent, fpStamp } from '../fingerprint.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runRender(ctx) {
  const { projectId, project, config, size, dir, resume } = ctx;
  const visualMode = config.visualMode || 'animation';
  const animLike = visualMode !== 'image'; // animation + hyperframe share the GSAP renderer
  step(projectId, 'b6', 'running', animLike ? 'Render animation từng frame' : 'Render cảnh');
  DB.updateProject(projectId, { current_step: 'b6' });
  const scenes = DB.getScenes(projectId);
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
    DB.updateScene(sc.id, { video_path: path, duration, status: 'rendered', error: null, ...(preview ? { image_path: preview } : {}),
      fp: fpStamp(sc, 'render', renderFingerprint(sc, ctx)) });
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
  // pool 'render': process-wide bound — concurrent pipelines/manual renders share it
  await mapPool(scenes, rC, async (sc) => {
    checkStop(projectId);
    if (resume && sc.video_path && existsSync(sc.video_path)) {
      // content-hash resume: keep the clip only while its inputs (template/props/visual
      // config) are unchanged; legacy rows without a stamp stay trusted
      if (fpCurrent(sc, 'render', renderFingerprint(sc, ctx))) return;
      op(projectId, `♻️ Cảnh ${sc.idx + 1}: visual/cấu hình đã thay đổi — render lại`);
    }
    op(projectId, `🎬 Render cảnh ${sc.idx + 1}/${scenes.length}`);
    try { await renderHealed(sc); }
    catch (e) {
      if (e.stopped) throw e;
      failedScenes.push(sc.id);
      DB.updateScene(sc.id, { status: 'error', error: e.message });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'error', error: e.message });
    }
  }, { pool: 'render' });
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
      ? await qcSceneClip(sc.video_path, {
        expectDur: sc.duration || 0,
        // narrated scene → the clip must carry actual speech, not just an audio stream;
        // a scene rendered without audio_path is intentionally silent (manual render-only)
        expectVoice: !!(sc.audio_path && (sc.voice_text || '').trim()),
      })
      : { ok: false, reason: 'file thiếu' };
    if (!check.ok) {
      op(projectId, `🩹 Cảnh ${sc.idx + 1}: ${check.reason} — render lại…`);
      logger.warn(`scene ${sc.idx} failed verification (${check.reason}) — re-rendering`, { projectId });
      await renderHealed(sc);
    }
  }
  step(projectId, 'b6', 'done');
  checkStop(projectId);
}
