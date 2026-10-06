// Pipeline orchestrator: B2 script → B5 visuals (against estimated timing) → [scene gate]
// → B3+4 TTS/SRT → B6 render → B7 concat/mix → B8 QC. Each stage lives in its own module and
// receives the shared context; this file only sequences them, emits the lifecycle WS events,
// and owns the macro self-heal (one auto-resume).
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { logger } from '../util/log.js';
import { sleep } from '../util/retry.js';
import { classifyError } from '../core/errors.js';
import { buildContext } from './context.js';
import { requestStop, clearStop, checkStop, isStopped } from './stop.js';
import { op } from './progress.js';
import { jlog } from './journal.js';
import { seedEstimatedTiming } from './estimate.js';
import { runScript } from './stages/script.js';
import { runEditorial } from './stages/editorial.js';
import { runScriptGate } from './stages/script-gate.js';
import { runBudgetFit } from './stages/budget.js';
import { runTts } from './stages/tts.js';
import { runVisuals } from './stages/visuals.js';
import { runRender } from './stages/render.js';
import { finalize } from './stages/finalize.js';
import { runMetadata } from './stages/metadata.js';
import { runPublish } from './stages/publish.js';
import { isEditVideo, runEditVideo } from './edit-video.js';

import { m, tp } from '../i18n/t.js';
// Stable import surface for pipeline/queue.js — the public pipeline entry points.
export { requestStop, clearStop };
export { renderOnly } from './render-only.js';
export { regenOne } from './regen.js';

export async function runPipeline(projectId, { resume = false, _auto = 0 } = {}) {
  clearStop(projectId);
  const ctx = buildContext(projectId, { resume });
  const { config, dir, size } = ctx;

  DB.updateProject(projectId, { status: 'running', error: null });
  hub.toProject(projectId, { type: 'status', status: 'running' });
  jlog(projectId, { kind: 'status', msg: resume ? m('▶ Tiếp tục pipeline') : m('🚀 Bắt đầu pipeline') });

  try {
    // EDIT VIDEO (P40): the user's own file IS the content, so there is no script and no TTS —
    // transcribe, cut, then rejoin the ordinary visuals/render/finalize stages. Routed here (not
    // as a separate job kind) so stop, resume, the job ledger and the error taxonomy below all
    // apply unchanged.
    if (isEditVideo(config)) {
      const res = await runEditVideo(ctx);
      if (config.generateMetadata === true) await runMetadata(ctx);
      DB.updateProject(projectId, { status: 'done' });
      const done = DB.getProject(projectId);
      hub.toProject(projectId, { type: 'done', video: done.video_path ? `/api/file?path=${encodeURIComponent(done.video_path)}` : null,
        thumb: done.thumb_path ? `/api/file?path=${encodeURIComponent(done.thumb_path)}` : null });
      logger.info(tp`🎉 Sửa video hoàn thành (${Math.round(res.duration)}s)`, { projectId, kind: 'done', jlevel: 'success' });
      return;
    }

    await runScript(ctx);                                   // B2
    await runEditorial(ctx);                                // b2.5 — quality gate (B2 banner)
    // b2.6 — the channel's own value/policy contract, opt-in per channel. Runs whatever editorial
    // did or skipped: a script with no defects to rewrite is exactly the one worth measuring.
    runScriptGate(ctx);
    await runBudgetFit(ctx);                                // b2.75 — total narration ≈ ordered duration
    // Scenes-first order: visuals are planned/generated BEFORE the paid voice, against an
    // estimated timeline (seedEstimatedTiming); real TTS then overwrites duration + srt_json
    // and the hyperframe time-warp (props.plannedDur → S.tplScale) reconciles baked
    // animation times with the real duration at render.
    seedEstimatedTiming(ctx);
    await runVisuals(ctx);                                  // B5

    // Scene gate: with config.sceneGate the run holds at a DISTINCT 'scenes' status after
    // visuals, BEFORE any TTS credit is spent — the user reviews/edits every scene, then
    // POST /projects/:id/approve-scenes stamps scenes_approved_at and resumes. Same clean-
    // return pattern as the review gate below: never 'paused' (P13 must not mistake a hold
    // for a crash) and never the error path (P10 auto-resume can never skip the gate).
    if (config.sceneGate === true && !DB.getProject(projectId).scenes_approved_at
      && DB.getScenes(projectId).some((s) => !s.audio_path)) {
      // The unvoiced check keeps the gate purposeful: a repurposed/fully-voiced project has
      // no TTS credit left to protect, so holding it would only stall a one-click flow.
      DB.updateProject(projectId, { status: 'scenes' });
      hub.toProject(projectId, { type: 'status', status: 'scenes' });
      op(projectId, tp`🎬 Cảnh đã dựng xong ${DB.getScenes(projectId).length} cảnh — duyệt/chỉnh sửa rồi bấm "Lồng tiếng & Render" để tiếp tục`);
      logger.info(m('⏸ Giữ ở cổng duyệt cảnh — chờ bạn duyệt storyboard rồi mới lồng tiếng'), { projectId, kind: 'status' });
      return;
    }

    await runTts(ctx);                                      // B3+4
    await runRender(ctx);                                   // B6

    // Review gate: with config.requireReview the run holds at a DISTINCT 'review' status
    // before concat until every scene is approved (rough-cut player chips). Deliberately
    // NOT 'paused' — P13's zombie recovery must never mistake a clean hold for a crash.
    // A clean return (not the error path) → the macro auto-resume (P10) is never involved.
    if (config.requireReview === true) {
      const ids = DB.getScenes(projectId).map((s) => s.id);
      const pending = DB.pendingReview(projectId, ids);
      if (pending.length) {
        DB.updateProject(projectId, { status: 'review' });
        hub.toProject(projectId, { type: 'status', status: 'review' });
        op(projectId, tp`🧐 Chờ duyệt ${pending.length}/${ids.length} cảnh — mở "▶ Xem nháp" để duyệt, rồi bấm Tiếp tục`);
        logger.info(tp`🧐 Giữ ở cổng duyệt: còn ${pending.length} cảnh chờ bạn duyệt`, { projectId, kind: 'status' });
        return;
      }
    }

    if (config.autoConcat !== false) await finalize(projectId, { dir, size, config }); // B7 + B8
    // Between the join and 'done' there used to be no checkpoint at all, so a stop that arrived
    // during the last stages was simply overwritten by success: the user pressed Dừng, waited,
    // and watched the video finish anyway.
    checkStop(projectId);
    if (config.generateMetadata !== false) await runMetadata(ctx);
    await runPublish(ctx); // B9 — opt-in (config.autoPublish), stages private by default
    checkStop(projectId); // publishing is the last thing that can be spent; 'done' is a promise

    DB.updateProject(projectId, { status: 'done' });
    const fin = DB.getProject(projectId);
    hub.toProject(projectId, { type: 'done', video: fin.video_path ? `/api/file?path=${encodeURIComponent(fin.video_path)}` : null,
      thumb: fin.thumb_path ? `/api/file?path=${encodeURIComponent(fin.thumb_path)}` : null });
    // Show-Bible write-back (best-effort, like metadata — never blocks status:done):
    // the finished video's topic joins the channel's anti-repeat ledger.
    try { if (fin.channel_id) DB.appendChannelTopic(fin.channel_id, fin.title || fin.topic); }
    catch (e) { logger.warn(tp`Ghi sổ Show-Bible lỗi: ${e.message}`, { projectId }); }
    logger.info(m('🎉 Video hoàn thành'), { projectId, kind: 'done', jlevel: 'success' });
  } catch (e) {
    if (e.stopped) {
      DB.updateProject(projectId, { status: 'paused' });
      // The durable flag has done its job the moment the run settles as paused. Leaving it set
      // would make the next boot cancel a job the user had since started again.
      DB.clearStopRequest(projectId);
      hub.toProject(projectId, { type: 'status', status: 'paused' });
      logger.warn(m('⏹ Đã dừng theo yêu cầu của bạn'), { projectId, kind: 'status' });
    } else {
      // Error taxonomy: deterministic config/resource failures surface IMMEDIATELY with an
      // actionable message — an auto-resume cannot fix a bad API key or a missing binary.
      // Transient/rate-limit (and anything unknown) keeps the macro self-heal: exactly one
      // automatic resume (P10) — completed work is on disk/DB, so it only redoes the
      // failing part. A misclassification can only ever ADD a resume, never remove one.
      const kind = classifyError(e);
      if (kind.retryable && _auto < 1) {
        logger.warn(tp`🩹 Lỗi [${kind.cls}]: ${e.message} — tự động chạy tiếp sau 8 giây`, { projectId, kind: 'retry' });
        hub.toProject(projectId, { type: 'retry', scope: 'pipeline', attempt: 1, msg: e.message, cls: kind.cls, delayMs: 8000 });
        op(projectId, tp`🩹 Gặp lỗi "${e.message.slice(0, 100)}" — tự động chạy tiếp sau 8 giây…`);
        await sleep(8000);
        if (!isStopped(projectId)) return runPipeline(projectId, { resume: true, _auto: _auto + 1 });
        DB.updateProject(projectId, { status: 'paused' });
        hub.toProject(projectId, { type: 'status', status: 'paused' });
      } else {
        DB.updateProject(projectId, { status: 'error', error: e.message });
        hub.toProject(projectId, { type: 'error', msg: e.message, cls: kind.cls, hint: kind.hint });
        if (!kind.retryable) op(projectId, `⛔ ${kind.hint}`);
        logger.error(tp`⛔ Pipeline lỗi [${kind.cls}]: ${e.message}`, { projectId, kind: 'error', data: { cls: kind.cls, hint: kind.hint } });
      }
    }
  } finally {
    clearStop(projectId);
  }
}
