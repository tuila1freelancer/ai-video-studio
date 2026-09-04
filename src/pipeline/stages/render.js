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
import { qcSceneClip } from '../qc.js';
import { checkStop } from '../stop.js';
import { step, op, progressPlan } from '../progress.js';
import { mapPool } from '../helpers.js';
import { renderFingerprint, renderCurrent, fpCurrent, fpStamp, stampRendered } from '../fingerprint.js';
import { timed } from '../stats.js';

import { m, tp } from '../../i18n/t.js';
/** @param {import('../context.js').PipelineContext} ctx */
export async function runRender(ctx) {
  const { projectId, project, config, dir, resume } = ctx;
  step(projectId, 'b6', 'running', m('Render animation từng frame'));
  DB.updateProject(projectId, { current_step: 'b6' });
  const scenes = DB.getScenes(projectId);
  const rC = parseInt(config.renderConcurrency || 3, 10);
  const pp = progressPlan(scenes, config);

  const renderSceneOnce = async (sc) => {
    // measured per scene so the change-cost table quotes THIS project's numbers, not a guess
    const r = await timed(projectId, 'render', () => renderAnimationScene(sc, project, config, {
      dir: join(dir, 'render'), progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: scenes.length,
      onProgress: (f) => { if (f >= 0.999 || Math.round(f * 4) !== Math.round((f - 0.01) * 4)) op(projectId, tp`🎬 Cảnh ${sc.idx + 1}/${scenes.length} · ${(f * 100).toFixed(0)}%`); },
      // a substituted font used to reach logger.warn and nowhere the owner looks
      onLog: (s) => op(projectId, tp`cảnh ${sc.idx + 1}: ${s}`),
    }));
    const { path, duration, preview } = r;
    DB.updateScene(sc.id, { video_path: path, duration, status: 'rendered', error: null, ...(preview ? { image_path: preview } : {}),
      fp: stampRendered(sc, renderFingerprint(sc, ctx)) });
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
      logger.warn(tp`Cảnh ${sc.idx + 1}: render lỗi (${e.message}) — đang tự chữa`, { projectId, kind: 'retry', stage: 'b6', sceneIdx: sc.idx });
      hub.toProject(projectId, { type: 'retry', scope: 'scene', step: 'b6', idx: sc.idx, attempt: 1, msg: e.message });
      // P10 template-swap heal applies to NON-hyperframe fallback scenes only (a legacy
      // template row or a chapter-break). A hyperframe scene is the primary model's HTML —
      // swapping it for a heuristic template is a quality fallback the NO-FALLBACK contract
      // (P25) forbids: it retries as-is (here + the deferred sequential pass); if it still
      // cannot render, the run fails loudly.
      if (sc.template !== 'kinetic-statement' && sc.template !== 'hyperframe') {
        op(projectId, tp`🩹 Cảnh ${sc.idx + 1}: đổi template dự phòng rồi thử lại…`);
        DB.updateScene(sc.id, { template: 'kinetic-statement', props: {
          pre: '', heading: headline(sc.voice_text || '', 40), heading2: '', sub: undefined,
        } });
        sc = DB.getScene(sc.id);
      } else {
        op(projectId, tp`🩹 Cảnh ${sc.idx + 1}: thử lại…`);
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
      const cur = renderCurrent(sc, ctx);
      if (cur.ok) {
        // stamped under the older digest definition — the clip is fine, the hash moved. Carry it
        // forward so the compatibility check is needed exactly once.
        if (cur.migrate) DB.updateScene(sc.id, { fp: fpStamp(sc, 'render', cur.want) });
        return;
      }
      op(projectId, tp`♻️ Cảnh ${sc.idx + 1}: visual/cấu hình đã thay đổi — render lại`);
    }
    op(projectId, tp`🎬 Render cảnh ${sc.idx + 1}/${scenes.length}`);
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
    op(projectId, tp`🩹 Thử lại ${failedScenes.length} cảnh lỗi (tuần tự)…`);
    for (const sid of failedScenes) {
      checkStop(projectId);
      await renderHealed(DB.getScene(sid));
    }
  }
  // Verify & repair: every scene clip must exist, probe sane, carry BOTH streams (a silent
  // scene is a defect, never shipped) and match its voice duration.
  op(projectId, m('🔍 Kiểm tra chất lượng từng cảnh…'));
  for (const sc of DB.getScenes(projectId)) {
    checkStop(projectId);
    const check = sc.video_path && existsSync(sc.video_path)
      ? await qcSceneClip(sc.video_path, { expectDur: sc.duration || 0 })
      : { ok: false, reason: m('file thiếu') };
    if (!check.ok) {
      op(projectId, tp`🩹 Cảnh ${sc.idx + 1}: ${check.reason} — render lại…`);
      logger.warn(tp`Cảnh ${sc.idx + 1}: clip không đạt kiểm tra (${check.reason}) — render lại`, { projectId, kind: 'retry', stage: 'b6', sceneIdx: sc.idx });
      await renderHealed(sc);
    }
  }
  step(projectId, 'b6', 'done');
  checkStop(projectId);
}
