// Broadcast master (P9's -16 LUFS authority): correct the audio only, never re-encode the picture.
import { logger } from '../../util/log.js';
import { masterAudio } from '../../media/master.js';
import { abortSignalFor, checkStop } from '../stop.js';
import { op } from '../progress.js';
import { m, tp } from '../../i18n/t.js';

/**
 * @param {{projectId:string, path:string}} args
 * @returns {Promise<{lufs:number|null, truePeak:number|null, corrected:boolean}>}
 */
export async function masterProgram({ projectId, path }) {
  // Broadcast master (P9's -16 LUFS authority, relocated from the concat graph): measure
  // the mixed program, correct the AUDIO ONLY (-c:v copy — video is never re-encoded).
  checkStop(projectId);
  let mastered = { lufs: null, truePeak: null, corrected: false };
  try {
    op(projectId, m('🎚️ Master âm thanh chuẩn phát sóng (-16 LUFS)…'));
    mastered = await masterAudio(path, {
      signal: abortSignalFor(projectId),
      onLog: (s) => logger.debug(s, { projectId }),
    });
    if (mastered.corrected) op(projectId, tp`🎚️ Đã master: ${mastered.lufs?.toFixed(1)} LUFS · true-peak ${mastered.truePeak?.toFixed(1)} dB`);
  } catch (e) {
    // A failed master is cosmetic and never worth failing a video over — but a STOP is not a
    // failure, and swallowing it here would carry straight on into QC and the thumbnail.
    if (e.stopped) throw e;
    logger.warn(tp`master: ${e.message} — giữ bản mix gốc`, { projectId });
  }
  return mastered;
}
