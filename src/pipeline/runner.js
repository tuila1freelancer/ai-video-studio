// Pipeline orchestrator: B2 script → B3+4 TTS/SRT → B5 visuals → B6 render → B7 concat/mix
// → B8 QC. Each stage lives in its own module and receives the shared context; this file only
// sequences them, emits the lifecycle WS events, and owns the macro self-heal (one auto-resume).
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { logger } from '../util/log.js';
import { sleep } from '../util/retry.js';
import { classifyError } from '../core/errors.js';
import { buildContext } from './context.js';
import { requestStop, clearStop, isStopped } from './stop.js';
import { op } from './progress.js';
import { runScript } from './stages/script.js';
import { runTts } from './stages/tts.js';
import { runVisuals } from './stages/visuals.js';
import { runRender } from './stages/render.js';
import { finalize } from './stages/finalize.js';
import { runMetadata } from './stages/metadata.js';

// Stable import surface for pipeline/queue.js — the public pipeline entry points.
export { requestStop, clearStop };
export { renderOnly } from './render-only.js';
export { regenOne } from './regen.js';
export { brandGenImpl } from './brandgen.js';

export async function runPipeline(projectId, { resume = false, _auto = 0 } = {}) {
  clearStop(projectId);
  const ctx = buildContext(projectId, { resume });
  const { config, dir, size } = ctx;

  DB.updateProject(projectId, { status: 'running', error: null });
  hub.toProject(projectId, { type: 'status', status: 'running' });

  try {
    await runScript(ctx);                                   // B2
    await runTts(ctx);                                      // B3+4
    await runVisuals(ctx);                                  // B5
    await runRender(ctx);                                   // B6
    if (config.autoConcat !== false) await finalize(projectId, { dir, size, config }); // B7 + B8
    if (config.generateMetadata !== false) await runMetadata(ctx);

    DB.updateProject(projectId, { status: 'done' });
    const fin = DB.getProject(projectId);
    hub.toProject(projectId, { type: 'done', video: fin.video_path ? `/api/file?path=${encodeURIComponent(fin.video_path)}` : null,
      thumb: fin.thumb_path ? `/api/file?path=${encodeURIComponent(fin.thumb_path)}` : null });
    // Show-Bible write-back (best-effort, like metadata — never blocks status:done):
    // the finished video's topic joins the channel's anti-repeat ledger.
    try { if (fin.channel_id) DB.appendChannelTopic(fin.channel_id, fin.title || fin.topic); }
    catch (e) { logger.warn(`show-bible write-back: ${e.message}`, { projectId }); }
    logger.info('Pipeline done', { projectId });
  } catch (e) {
    if (e.stopped) {
      DB.updateProject(projectId, { status: 'paused' });
      hub.toProject(projectId, { type: 'status', status: 'paused' });
      logger.warn('Pipeline stopped', { projectId });
    } else {
      // Error taxonomy: deterministic config/resource failures surface IMMEDIATELY with an
      // actionable message — an auto-resume cannot fix a bad API key or a missing binary.
      // Transient/rate-limit (and anything unknown) keeps the macro self-heal: exactly one
      // automatic resume (P10) — completed work is on disk/DB, so it only redoes the
      // failing part. A misclassification can only ever ADD a resume, never remove one.
      const kind = classifyError(e);
      if (kind.retryable && _auto < 1) {
        logger.warn(`Pipeline error [${kind.cls}]: ${e.message} — auto-resume in 8s`, { projectId });
        hub.toProject(projectId, { type: 'retry', scope: 'pipeline', attempt: 1, msg: e.message, cls: kind.cls, delayMs: 8000 });
        op(projectId, `🩹 Gặp lỗi "${e.message.slice(0, 100)}" — tự động chạy tiếp sau 8 giây…`);
        await sleep(8000);
        if (!isStopped(projectId)) return runPipeline(projectId, { resume: true, _auto: _auto + 1 });
        DB.updateProject(projectId, { status: 'paused' });
        hub.toProject(projectId, { type: 'status', status: 'paused' });
      } else {
        DB.updateProject(projectId, { status: 'error', error: e.message });
        hub.toProject(projectId, { type: 'error', msg: e.message, cls: kind.cls, hint: kind.hint });
        if (!kind.retryable) op(projectId, `⛔ ${kind.hint}`);
        logger.error(`Pipeline error [${kind.cls}]: ${e.message}`, { projectId });
      }
    }
  } finally {
    clearStop(projectId);
  }
}
