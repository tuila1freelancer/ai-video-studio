// The final join (B7): clips → transitions → mix → overlays → captions → encode, in one ffmpeg pass.

import { join } from 'node:path';
import { ffmpeg, ffmpegAss, probeDuration, probeImageSize, probeFrameRate } from '../media/ffmpeg.js';
import { planOffsets, XFADE_DUR } from '../subtitles/timeline.js';
import { concatFingerprint, needsVideoFilter, planConcat, tierLog } from './concat-plan.js';
import { ratioToSize, newId } from '../util/util.js';
import { mapPool } from './helpers.js';
import { MAX_GRAPH_CLIPS } from './render/transitions.js';
import { buildBurnedCaptions } from './render/captions.js';
import { newGraph, chainClips, mixAudio, overlayLogo, overlayWatermark, finishVideo } from './render/graph.js';
import { FPS, ffProgress, videoCodecArgs } from './render/encode.js';
import { m, tp } from '../i18n/t.js';

export { planTransitions, transitionLoss, MAX_GRAPH_CLIPS, TRANSITION_STYLES } from './render/transitions.js';
export { ffProgress } from './render/encode.js';
export { ratioToSize };

export async function concatScenes(sceneVideos, project, {
  dir, size, bgmPath, sfxPath, logo, watermark, transitions, onLog, onNote, bgmVol,
  subtitles = null, masterFade = true, encoder = 'quality',
  prevPath = null, prevFp = null, allowSkip = true,
  // Forwarded straight to the encoder so a stop can end the join instead of waiting it out.
  signal = undefined,
}) {
  if (!sceneVideos.length) throw new Error(m('Không có cảnh nào để ghép'));
  const ow = size.w, oh = size.h;

  // The frame an overlay lands on is whatever the CLIPS are — not what the caller believes.
  //
  // `size` is the LOGICAL 1080-class canvas the scenes were authored in (ratioToSize). A project
  // with `resolutionScale: 2` renders its clips at 3840×2160, and nothing below rescales them, so
  // the finished file is 4K while every caller still hands this function 1920×1080. logoRect then
  // computed half the width at half the fraction: measured on a finished 4K video, a stamp stored
  // at cx=0.936 (top right) was drawn at cx=0.468 — the middle of the frame — and the rect
  // predicted from the 1080 space framed it exactly. The edit-video lane is worse still: it
  // composites onto the owner's own footage, whose size is nobody's ratio.
  //
  // Captions deliberately keep using `size`. An ASS document declares its own PlayRes and libass
  // scales that space onto the frame, so the 1080-class coordinates render identically at 4K;
  // moving them would rewrite every project's `assText` digest for no visible change at all.
  const probed = await probeImageSize(sceneVideos[0]);
  const fw = probed?.w || ow, fh = probed?.h || oh;
  // Same reason as the frame size above: re-encoding at a constant 30 threw away every frame of
  // a 60fps project without saying so, and the fps control in the UI quietly did nothing.
  const ffps = (await probeFrameRate(sceneVideos[0])) || FPS;

  // Durations + timeline.
  const TD = XFADE_DUR;
  const durs = await mapPool(sceneVideos, 4, (v) => probeDuration(v));
  const plan = Array.isArray(transitions)
    ? transitions.slice(0, sceneVideos.length - 1)
    : (transitions ? sceneVideos.map(() => ({ type: 'fade', dur: TD })).slice(0, sceneVideos.length - 1) : null);
  const anyBlend = !!plan && plan.some((t) => t.type !== 'cut');
  const useGraph = anyBlend && sceneVideos.length > 1 && sceneVideos.length <= MAX_GRAPH_CLIPS;
  // planOffsets replays this loop's own arithmetic, clamp included, so the caption timeline and
  // the video can never disagree. (transitionLoss sums the PLANNED fade lengths and ignores the
  // per-join clamp — close enough for a QC tolerance, not for placing a subtitle.)
  const { starts, total } = planOffsets(durs, useGraph ? plan : null);
  const fadeOut = Math.max(0.2, total - 0.6);

  const slug = (project.title || 'video').replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '_').slice(0, 40) || 'video';
  const finalOut = join(project.outputDir || dir, `${slug}_${newId('')}.mp4`);
  const timeline = starts.map((s, i) => ({ start: +s.toFixed(3), end: +(s + (durs[i] || 0)).toFixed(3) }));

  const ass = await buildBurnedCaptions({ subtitles, starts, total, ow, oh, dir, note: onNote || onLog });

  // How little work will do? See pipeline/concat-plan.js — the file on disk plus the fingerprint
  // that produced it decide whether this is a full encode, a stream copy, an audio-only remux,
  // or nothing at all.
  const assText = ass?.text || null;
  // The EFFECTIVE plan, not the requested one. A plan the graph will not execute must not move the
  // fingerprint: while the clip cap was in force, changing the transition style on a long video
  // moved fp.video, dropped the tier to `encode`, and bought the owner a full re-encode whose
  // output was pixel-identical. The fingerprint has to describe the video that will actually be
  // made, so anything gating the graph has to gate the hash too.
  const effPlan = useGraph ? plan : null;
  const fp = concatFingerprint({
    clips: sceneVideos, size, frame: { w: fw, h: fh }, fps: ffps, transitions: effPlan, logo, watermark,
    assText, masterFade, encoder, bgmPath, sfxPath, bgmVol,
  });
  const videoFilter = needsVideoFilter({ logo, watermark, assText, transitions: effPlan, masterFade });
  const { tier, why } = planConcat({ fp, prev: prevFp, prevPath, videoFilter, allowSkip });
  (onNote || onLog)?.(`${tierLog(tier)} — ${why}`);
  if (tier === 'skip') {
    return { path: prevPath, thumb: project.thumb_path || null, duration: total, timeline, fp, tier };
  }

  // Single pass: (selective xfade/concat graph | concat-demuxer) → BGM mix → logo → fades → encode.
  const g = newGraph();
  // Tiers 'audio' and 'copy' keep the video stream untouched, so neither builds a video graph.
  const copyVideo = tier === 'audio' || tier === 'copy';
  chainClips(g, { sceneVideos, tier, prevPath, useGraph, plan, durs, TD, dir });
  mixAudio(g, { bgmPath, bgmVol, sfxPath });
  await overlayLogo(g, { logo, fw, fh, copyVideo });
  overlayWatermark(g, { watermark, fw, fh, dir, copyVideo });
  finishVideo(g, { ass, copyVideo, masterFade, fadeOut });
  const { args, fc, useAssBinary } = g;
  const cut = copyVideo && tier === 'audio' ? (await probeDuration(prevPath)) || total : total;
  args.push('-filter_complex', fc.join(';'));
  if (copyVideo) args.push('-map', '0:v', '-c:v', 'copy');
  else args.push('-map', '[vout]', ...videoCodecArgs(encoder, ffps));
  args.push('-map', '[aout]', '-t', cut.toFixed(2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', finalOut);
  // The join is the longest single step in the app — up to a quarter of an hour on a full-length
  // video — and it said nothing at all while it ran, because the ffmpeg wrapper runs at
  // `-loglevel error`. "✂️ Ghép & mix…" and then silence is indistinguishable from a hang, which
  // is the whole reason the owner asked for a live processing log.
  //
  // `-progress pipe:1` makes ffmpeg write key=value blocks to stdout; `out_time_us` against the
  // programme duration is the percentage. They stay on the TICKER: progress.js deliberately keeps
  // `· NN%` lines out of the journal, or one join would write a hundred rows into it.
  args.unshift('-progress', 'pipe:1', '-nostats'); // global options must precede the inputs
  const label = copyVideo ? (tier === 'audio' ? m('🔊 Trộn lại âm thanh') : m('⚡ Sao chép video')) : m('🎞 Mã hoá video hoàn chỉnh');
  const note = onNote || onLog;
  // The bracketing lines carry no percentage, so they DO reach the journal — the ticker shows
  // the live count, the journal keeps the record of what ran and how long it took.
  note?.(`${label} — ${sceneVideos.length} clip · ${Math.round(cut)}s${ass ? ` · ${m('có phụ đề in trực tiếp')}` : ''}`);
  const t0 = Date.now();
  await (useAssBinary ? ffmpegAss : ffmpeg)(args, {
    signal,
    onLog: ffProgress(cut, (pct) => note?.(`${label} · ${pct}%`), onLog),
  });
  note?.(tp`✅ Ghép xong sau ${Math.round((Date.now() - t0) / 1000)}s → ${finalOut.split('/').pop()}`);

  const thumb = join(project.outputDir || dir, `thumb_${newId('')}.jpg`);
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', finalOut, '-frames:v', '1', '-q:v', '3', thumb], { signal });
  return { path: finalOut, thumb, duration: total, timeline, fp, tier };
}
