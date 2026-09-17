// The join itself: one ffmpeg process that can run for a quarter of an hour, stoppable and checked.
import { logger } from '../../util/log.js';
import { concatScenes } from '../render.js';
import { probeDuration } from '../../media/ffmpeg.js';
import { withRetry } from '../../util/retry.js';
import { abortSignalFor, checkStop, notStopped } from '../stop.js';
import { op, retryHook } from '../progress.js';
import { timed } from '../stats.js';
import { tp } from '../../i18n/t.js';

/**
 * @param {{projectId:string, project:object, config:object, clips:string[], size:{w:number,h:number}, renderDir:string, bgmPath:string|null, sfxPath:string|null, sdPlan:object|null, transPlan:object[]|null, subtitles:object|null, expectDur:number}} args
 * @returns {Promise<object>} the concat result (path, duration, tier, fp, timeline, thumb)
 */
export async function joinClips({ projectId, project, config, clips, size, renderDir, bgmPath, sfxPath, sdPlan, transPlan, subtitles, expectDur }) {
  // What the previous export was made from, so the concat can charge only for what moved.
  const prevMeta = project.metadata?.concat || null;
  checkStop(projectId);
  const res = await timed(projectId, 'concat', () => withRetry(async () => {
    const r = await concatScenes(clips, project, {
      dir: renderDir, size, bgmPath, sfxPath, logo: config.logo, watermark: config.watermark,
      bgmVol: sdPlan?.bgmVol,
      masterFade: config.masterFade !== false,
      encoder: config.concatEncoder === 'fast' ? 'fast' : 'quality',
      prevPath: project.video_path || null,
      prevFp: prevMeta?.fp || null,
      // A re-concat may legitimately be a no-op; the FIRST assembly of a run never is, and
      // silently reusing an old file there would hide a pipeline that did nothing.
      allowSkip: !!prevMeta,
      transitions: transPlan || false, subtitles,
      // The join is one ffmpeg process that can run for a quarter of an hour. Checkpoints sit
      // BETWEEN steps and cannot interrupt it, so the stop reaches the encoder directly.
      signal: abortSignalFor(projectId),
      onLog: (s) => logger.debug(s, { projectId }),
      onNote: (s) => op(projectId, s),
    });
    // Output must exist and cover the scene material (10% tolerance + transition losses).
    const got = await probeDuration(r.path);
    if (!got || got < Math.max(1, expectDur * 0.88 - 4)) {
      throw new Error(tp`video ghép ngắn bất thường (${Math.round(got || 0)}s / kỳ vọng ~${Math.round(expectDur)}s)`);
    }
    return r;
    // `fatal` matters more than it looks: without it, aborting the encoder reads as a failed
    // attempt and withRetry starts the whole fifteen-minute join again — pressing stop would
    // have made the app do MORE work.
  }, { tries: 2, label: 'b7 concat', fatal: notStopped, onRetry: retryHook(projectId, 'b7') }));
  return res;
}
