// B7 concat/mix + B8 content quality gate. Repairs missing clips, appends intro/outro, mixes
// BGM + chapter-transition SFX, concatenates, then QC-decodes the finished video: any
// scene-attributable defect (black frame, dead air, missing audio) triggers ONE repair cycle
// (re-render those scenes → concat + QC again). The report always lands in qc_report.json.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { planTransitions } from '../render.js';
import { checkStop } from '../stop.js';
import { step, op } from '../progress.js';
import { resolveOutputDir } from '../helpers.js';
import { planOffsets } from '../../subtitles/timeline.js';
import { rebuildClips } from '../finalize/clips.js';
import { dressConfig } from '../finalize/dressing.js';
import { buildSoundtrack } from '../finalize/sound.js';
import { finalPassCaptions } from '../finalize/captions.js';
import { joinClips } from '../finalize/concat.js';
import { masterProgram } from '../finalize/master.js';
import { gateProgram } from '../finalize/qc.js';
import { packageCovers } from '../finalize/thumbnail.js';
import { m, tp } from '../../i18n/t.js';

/**
 * @param {string} projectId
 * @param {{dir:string, size:{w:number,h:number}, config:object, variantName?:string|null}} opts
 */
export async function finalize(projectId, { dir, size, config: given, variantName = null }) {
  // B7 used to carry NO stop checkpoint at all, which made it the longest unstoppable stretch in
  // the app: clip repairs, the join itself (measured at ~15 minutes on a long video), the audio
  // master, a QC decode, and an LLM thumbnail. Pressing "Dừng" anywhere in here did nothing, and
  // because the runner had no checkpoint after finalize either, the run went on to finish as
  // 'done'. The stop was not late — it was discarded.
  checkStop(projectId);
  step(projectId, 'b7', 'running', m('Ghép & mix'));
  DB.updateProject(projectId, { current_step: 'b7' });
  const project = DB.getProject(projectId);
  // This run's own copy, dressed with the live brand kit, logo and watermark — the caller's object
  // is never mutated, so the stages after the join keep seeing what the owner configured.
  const config = await dressConfig({ projectId, config: given, size });
  project.outputDir = resolveOutputDir(projectId, config, dir);
  const renderDir = join(dir, 'render');
  const all = DB.getScenes(projectId).sort((a, b) => a.idx - b.idx);

  await rebuildClips({ projectId, project, all, config: given, renderDir });
  const scenes = DB.getScenes(projectId).filter((s) => s.video_path && existsSync(s.video_path)).sort((a, b) => a.idx - b.idx);
  const clips = scenes.map((s) => s.video_path);
  const firstImg = scenes.find((s) => s.image_path && existsSync(s.image_path))?.image_path;
  const visualMode = config.visualMode || 'hyperframe';

  // No synthetic intro/outro cards (P31, owner order 2026-07-18 — reference-app parity):
  // the video is the SCRIPT's scenes and nothing else. The master script already ends on a
  // narrated closing-CTA scene whose HTML the codegen LLM designs like every other scene —
  // exactly how the reference sessions work (their clip count == scene count). The old
  // hardcoded farewell card made every video end identically.

  // Doctrine transition plan (P5): hard cuts by default, role-driven hero transitions.
  // Computed BEFORE the SFX bed and QC so their timelines account for xfade overlaps exactly.
  const transPlan = config.transitions === true && clips.length > 1
    ? planTransitions({ scenes, clipCount: clips.length, nIntro: 0, nOutro: 0, style: config.transitionStyle || 'auto' })
    : null;
  // Cumulative xfade loss BEFORE scene k's clip starts (clip index == scene order now), taken
  // from the SAME function the concat uses to place the clips.
  //
  // This used to be `transitionLoss(transPlan, k)`, which sums the PLANNED fade lengths and knows
  // nothing about the per-join clamp — and, worse, nothing about whether the transitions run at
  // all. `transPlan` is built unconditionally here while the renderer used to skip the whole xfade
  // branch above 24 clips, so on every long video each sound effect was placed 0.2s × k early:
  // forty seconds of drift by scene 200, on the videos the owner actually publishes.
  // planOffsets replays the concat's own arithmetic, so it is right in both cases.
  const sceneStarts = planOffsets(scenes.map((s) => s.duration || 0), transPlan).starts;
  const lossBeforeScene = (k) => {
    let material = 0;
    for (let i = 0; i < k; i++) material += scenes[i]?.duration || 0;
    return Math.max(0, material - (sceneStarts[k] ?? material));
  };

  op(projectId, m('✂️ Ghép & mix…'));
  const expectDur = scenes.reduce((a, s) => a + (s.duration || 0), 0);

  const { sdPlan, bgmPath, sfxPath } = await buildSoundtrack({ projectId, project, config, scenes, renderDir, expectDur, lossBeforeScene });
  const subtitles = finalPassCaptions({ projectId, config, size, scenes, renderDir });
  const res = await joinClips({ projectId, project, config, clips, size, renderDir, bgmPath, sfxPath, sdPlan, transPlan, subtitles, expectDur });

  // Nothing moved — the export on disk IS the answer. Everything below (audio master, QC decode,
  // thumbnail) would re-do work whose inputs are provably identical, so it is skipped too rather
  // than quietly burning a couple of minutes to arrive back where we started.
  if (res.tier === 'skip') {
    step(projectId, 'b7', 'done', `${Math.round(res.duration)}s`);
    return res;
  }

  const mastered = await masterProgram({ projectId, path: res.path });
  await gateProgram({ projectId, dir, config, res, mastered, expectDur });
  const thumb = await packageCovers({ projectId, project, config, size, scenes, res, firstImg, visualMode });

  // The exact timeline this export was assembled on. Everything that has to map a moment in the
  // finished video back to a scene reads THIS — burned captions, the SRT export, the player's
  // click-to-scene jump — instead of re-deriving offsets from scene durations and drifting.
  // `concat.fp` is what lets the next assembly know how little work it has to do.
  {
    const md = DB.getProject(projectId).metadata || {};
    DB.updateProject(projectId, {
      metadata: {
        ...md,
        timeline: (res.timeline || []).map((t, i) => ({ sceneId: scenes[i]?.id, idx: scenes[i]?.idx, ...t })),
        concat: { fp: res.fp || null, tier: res.tier || null, at: Date.now() },
      },
    });
  }
  // A VARIANT is a second deliverable from the same clips — it must not take over as "the"
  // video, or asking for a no-logo cut would quietly replace the one being published.
  if (!variantName) DB.updateProject(projectId, { video_path: res.path, thumb_path: thumb, current_step: 'b7' });
  else op(projectId, tp`📦 Biến thể "${variantName}" đã xuất — video chính giữ nguyên`);
  // Index this export. The file was always kept — nothing indexed it, which is the difference
  // between "I could go back if I had to" and "I dare not try anything".
  try {
    DB.recordRender({
      projectId, path: res.path, thumb, duration: res.duration, tier: res.tier || 'encode',
      config, variant: variantName,
    });
  } catch (e) { logger.warn(tp`không ghi được lịch sử phiên bản: ${e.message}`, { projectId }); }
  step(projectId, 'b7', 'done', `${Math.round(res.duration)}s`);
  return res;
}
