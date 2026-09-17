// Clips that must exist before the join: missing ones, and on the final-pass burn lane, stale ones.
import { existsSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { renderAnimationScene } from '../../animation/index.js';
import { checkStop } from '../stop.js';
import { op, progressPlan } from '../progress.js';
import { renderCurrent, renderFingerprint, stampRendered } from '../fingerprint.js';
import { tp } from '../../i18n/t.js';

/**
 * Render whatever the join cannot go without. Every rebuilt clip is re-stamped, or the very next
 * join would find the same scene stale again.
 * @param {{projectId:string, project:object, all:object[], config:object, renderDir:string}} args
 */
export async function rebuildClips({ projectId, project, all, config, renderDir }) {
  // Which clips have to be built before the join?
  //
  //   missing — never silently drop a scene from the final cut.
  //   stale   — only when the final-pass burn is about to run. Printing captions onto a clip
  //             that already draws captions INSIDE it ships a video with two rows of subtitles,
  //             and the cheap ways into this function (a concat-only "ghép lại", a variant
  //             export) are precisely the ones that skip the render stage. A clip whose stamp no
  //             longer matches the config it is about to be joined under is the only evidence
  //             available that it may still carry them, so on this lane it is rebuilt bare
  //             rather than printed over.
  //
  // A clip is judged against the PROJECT's saved config, never this run's. They are the same
  // thing for a pipeline run, but a VARIANT export layers concat-level overrides on top
  // (`logo: null`, no music) — and `logo` is an input to the render digest, so asking the
  // question with the run config would report all 105 clips stale and re-render the lot to
  // produce a cut that differs by one overlay filter. It is also why this sits here rather than
  // further down: finalize is about to add the concat logo, the live brand kit and the watermark
  // to `config`, and none of those was ever an input to a clip.
  const clipCfg = project.config || config;
  const burnLane = config.subtitleLane === 'final' && config.enableSubtitles !== false;
  const missing = all.filter((s) => !(s.video_path && existsSync(s.video_path)));
  const missingIds = new Set(missing.map((s) => s.id));
  const stale = burnLane
    ? all.filter((s) => !missingIds.has(s.id) && !renderCurrent(s, { config: clipCfg, project }, clipCfg).ok)
    : [];
  const rebuild = [...missing, ...stale].sort((a, b) => a.idx - b.idx);
  if (rebuild.length) {
    if (missing.length) {
      op(projectId, tp`🩹 ${missing.length} cảnh thiếu clip — render bù trước khi ghép…`);
      logger.warn(tp`Ghép video: ${missing.length} cảnh thiếu clip — đang render bù`, { projectId, stage: 'b7' });
    }
    if (stale.length) {
      op(projectId, tp`♻️ ${stale.length} cảnh có clip không khớp cấu hình hiện tại — dựng lại KHÔNG phụ đề trước khi in phụ đề lên bản ghép`);
      logger.warn(tp`Ghép video: ${stale.length} clip lệch cấu hình — dựng lại trước khi in phụ đề`, { projectId, stage: 'b7' });
    }
    const pp = progressPlan(all, config);
    let n = 0;
    for (const sc of rebuild) {
      checkStop(projectId); // a repair pass can be dozens of renders — one per scene is the checkpoint
      op(projectId, tp`🎬 Dựng lại cảnh ${sc.idx + 1} (${++n}/${rebuild.length})`);
      const r = await renderAnimationScene(sc, project, clipCfg, {
        dir: renderDir, progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: all.length,
        onLog: (s) => op(projectId, tp`cảnh ${sc.idx + 1}: ${s}`),
      });
      // Stamp the clip. Without this the repair leaves the OLD fingerprint next to a NEW file,
      // so the very next join would find the same scene stale and rebuild it all over again.
      DB.updateScene(sc.id, {
        video_path: r.path, duration: r.duration, status: 'rendered', error: null,
        fp: stampRendered(sc, renderFingerprint(sc, { config: clipCfg, project })),
      });
    }
  }
}
