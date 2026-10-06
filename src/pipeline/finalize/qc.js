// B8: the final integrity gate — a cheap stream/duration check on the joined video, report on disk.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../util/log.js';
import { qcFinalVideo } from '../qc.js';
import { op } from '../progress.js';
import { m, tp } from '../../i18n/t.js';

/**
 * @param {{projectId:string, dir:string, config:object, res:object, mastered:object, expectDur:number}} args
 */
export async function gateProgram({ projectId, dir, config, res, mastered, expectDur }) {
  // ---- B8: final integrity gate — a cheap stream/duration check on the joined video.
  // P38: the heavy per-frame QC (black/white-frame + dead-air scanning, scene-attributable
  // re-render, and visual quality-tier surfacing) is REMOVED — the user dropped the "cảnh lỗi"
  // QC as redundant, and the reference app ships none of it. A broken JOIN still surfaces here.
  if (config.qcGate !== false) {
    op(projectId, m('🔬 Kiểm tra video thành phẩm (stream + thời lượng)…'));
    // Expected FINAL duration comes from the join itself. It used to be recomputed here as
    // `expectDur - transitionLoss(...)`, guarded by a clip-count cap copied from the renderer —
    // a second arithmetic that had to be kept in step with the first, and could not account for
    // the per-join clamp. `res.duration` IS planOffsets' total, so there is nothing to keep in step.
    const qc = await qcFinalVideo(res.path, { expectDur: res.duration || expectDur, tolerancePct: 8 });
    writeFileSync(join(dir, 'qc_report.json'), JSON.stringify({
      ...qc,
      loudness: { lufs: mastered.lufs, truePeak: mastered.truePeak, corrected: mastered.corrected },
      at: new Date().toISOString(),
    }, null, 2));
    if (!qc.ok) {
      logger.warn(tp`QC: ${qc.issues.length} vấn đề (${qc.issues.map((i) => i.type).join(', ')})`, { projectId });
      op(projectId, tp`⚠️ Video có ${qc.issues.length} cảnh báo tính toàn vẹn (xem qc_report.json) — vẫn được xuất`);
    } else {
      op(projectId, m('✅ Video hợp lệ: đủ stream, thời lượng khớp'));
    }
  }
}
