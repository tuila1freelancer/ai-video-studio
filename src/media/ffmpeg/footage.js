// The user's own footage (P40/P43/P44): overlay composite with reframe bias, silence removal, auto zoom.
import { spawn } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { PATHS } from '../../config/paths.js';
import { m, tp } from '../../i18n/t.js';
import { ffmpeg } from './run.js';
import { probeDuration, probeImageSize } from './probe.js';

// Overlay-mode composite (reference-app parity): the scene clip's key color becomes
// transparent and the motion graphics land on a slice of the user's base footage. The
// slice offset wraps around the footage length so any video length works; footage shorter
// than the scene is frozen on its last frame (tpad clone) rather than cut to black.
// Scene AUDIO (the narration) is kept; the footage's own audio is dropped.
// `exact` + `audioFrom:'footage'` switch this into EDIT-VIDEO mode (P40): the graphics belong to
// one specific moment of the user's own video, so the slice is taken at exactly `start` (never
// wrapped) and the ORIGINAL soundtrack is kept instead of a narration track.

/**
 * Where the subject sits in a frame, as a 0..1 horizontal fraction (P43 — reference
 * `detectSubjectPosition`). One cheap cropdetect probe over half a second: cropdetect reports the
 * non-black content box, and its centre is a good enough proxy for "where the person is" for the
 * purpose of biasing a crop. Returns null when nothing can be read, so the caller keeps centre.
 */
export async function detectSubjectX(file, { at = 1 } = {}) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffmpeg, ['-v', 'info', '-ss', String(Math.max(0, at)), '-i', file,
      '-t', '0.5', '-vf', 'cropdetect=24:2:0', '-f', 'null', '-']);
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', () => resolvePromise(null));
    ps.on('close', () => {
      const all = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
      const m = all[all.length - 1];
      const dim = /Video:.*?[,\s](\d{2,5})x(\d{2,5})/.exec(err);
      if (!m || !dim) return resolvePromise(null);
      const W = +dim[1];
      const cx = (+m[3] + (+m[1]) / 2) / W;      // content-box centre as a fraction of the width
      resolvePromise(Number.isFinite(cx) ? Math.min(1, Math.max(0, cx)) : null);
    });
  });
}

/** Horizontal crop offset in px for a reframe position. `subjectX` is 0..1 or null. */
export function reframeOffsetX(position, scaledW, outW, subjectX = null) {
  const slack = Math.max(0, scaledW - outW);
  if (!slack) return 0;
  if (position === 'left') return 0;
  if (position === 'right') return Math.round(slack);
  if (position === 'auto' && subjectX != null) {
    // put the detected subject in the middle of the output window, clamped to the real slack
    return Math.round(Math.min(slack, Math.max(0, subjectX * scaledW - outW / 2)));
  }
  return Math.round(slack / 2); // centre — what ffmpeg's bare crop= already does
}

/**
 * Dead air in a recording, from ffmpeg's `silencedetect` (P44 — reference `detectSilence`).
 * @returns {Promise<{start:number,end:number,duration:number}[]>}
 */
export async function detectSilence(file, { noiseDb = -30, minDuration = 0.6 } = {}) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffmpeg, ['-v', 'info', '-i', file,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, '-f', 'null', '-']);
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', () => resolvePromise([]));
    ps.on('close', () => {
      const starts = [...err.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
      const ends = [...err.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)];
      const out = [];
      for (let i = 0; i < starts.length; i++) {
        const s = Math.max(0, starts[i]);
        const e = ends[i] ? parseFloat(ends[i][1]) : s + minDuration;
        if (e > s) out.push({ start: +s.toFixed(3), end: +e.toFixed(3), duration: +(e - s).toFixed(3) });
      }
      resolvePromise(out);
    });
  });
}

/**
 * Turn detected silences into the ranges worth KEEPING (pure — the whole cut decision lives
 * here so it can be tested without ffmpeg).
 *
 * A gap is never cut out flush: `padMs` of its head and tail stay in so speech does not start
 * on a hard splice, and at least `keepMs` of every gap survives so the result still breathes.
 * A gap shorter than the padding therefore contributes nothing to cut and is skipped whole.
 * @returns {{start:number,end:number}[]} contiguous, ascending, inside [0,total]
 */
const MIN_CUT = 0.12; // seconds of dead air below which a splice costs more than it buys
export function silenceKeepRanges(silences = [], total = 0, { keepMs = 200, padMs = 100 } = {}) {
  const dur = Math.max(0, +total || 0);
  if (!dur) return [];
  const keep = Math.max(0, keepMs) / 1000;
  const pad = Math.max(0, padMs) / 1000;
  const gaps = (silences || [])
    .filter((s) => s && Number.isFinite(+s.start) && Number.isFinite(+s.end) && +s.end > +s.start)
    .map((s) => ({ start: Math.max(0, +s.start), end: Math.min(dur, +s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const g of gaps) {
    const cutFrom = Math.max(cursor, g.start + pad);                    // keep a beat of the head
    // …and of the tail. Clamped to the gap's own end: the reference's `max(end-pad, start+keep)`
    // runs PAST a gap shorter than `keep` and eats the first syllable of the next sentence.
    const cutTo = Math.min(g.end, Math.max(g.end - pad, g.start + keep));
    if (cutTo - cutFrom < MIN_CUT) continue;   // not enough dead air to be worth a splice
    if (cutFrom > cursor) out.push({ start: +cursor.toFixed(3), end: +cutFrom.toFixed(3) });
    cursor = Math.min(dur, cutTo);
  }
  if (cursor < dur) out.push({ start: +cursor.toFixed(3), end: +dur.toFixed(3) });
  return out.filter((r) => r.end - r.start > 0.02);
}

/**
 * Cut the dead air out of a recording (P44 — reference `removeSilence`).
 *
 * Done in ONE filter_complex pass (trim/atrim → concat) rather than the reference's
 * write-N-clips-then-concat-demux, so there is no intermediate generation loss and no temp
 * files to leak. Audio and video are trimmed with the SAME range list, so they cannot drift.
 * Nothing to cut → the file is copied through untouched.
 * @returns {Promise<{originalDuration:number,newDuration:number,segmentsRemoved:number,ranges:object[]}>}
 */
export async function removeSilence(inPath, outPath, {
  noiseDb = -30, minSilenceDuration = 0.6, keepMs = 200, padMs = 100, maxSegments = 240, onLog = () => {},
} = {}) {
  const originalDuration = await probeDuration(inPath);
  const silences = await detectSilence(inPath, { noiseDb, minDuration: minSilenceDuration });
  const ranges = silenceKeepRanges(silences, originalDuration, { keepMs, padMs });
  const nothingToDo = !silences.length || ranges.length <= 1 || ranges.length > maxSegments;
  if (nothingToDo) {
    if (ranges.length > maxSegments) onLog(tp`bỏ qua cắt lặng: ${ranges.length} đoạn là quá vụn`);
    else onLog(m('không có khoảng lặng đáng cắt — giữ nguyên file'));
    await copyFile(inPath, outPath);
    return { originalDuration, newDuration: originalDuration, segmentsRemoved: 0, ranges: [] };
  }
  const parts = ranges.map((r, i) =>
    `[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[v${i}];`
    + `[0:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[a${i}]`).join(';');
  const chain = ranges.map((_, i) => `[v${i}][a${i}]`).join('');
  await ffmpeg([
    '-i', inPath,
    '-filter_complex', `${parts};${chain}concat=n=${ranges.length}:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', outPath,
  ]);
  const newDuration = await probeDuration(outPath);
  onLog(tp`đã cắt ${silences.length} khoảng lặng: ${originalDuration.toFixed(1)}s → ${newDuration.toFixed(1)}s`);
  return { originalDuration, newDuration, segmentsRemoved: silences.length, ranges };
}

/** Focus point of a zoom as [x,y] fractions — where the frame converges as it pushes in. */
export function zoomFocus(point) {
  switch (point) {
    case 'top': return ['0.5', '0.3'];
    case 'face': return ['0.5', '0.35'];
    case 'left': return ['0.35', '0.5'];
    case 'right': return ['0.65', '0.5'];
    default: return ['0.5', '0.5'];
  }
}

/**
 * A slow push-in / pull-out for ONE scene of footage (P44 — reference `applySceneZoom`).
 *
 * Even scenes push in, odd scenes pull out, and the focus point rotates, so a long stretch of
 * talking-head footage never sits perfectly still. Unlike the reference — which hardcodes
 * `s=1920x1080` and so squashes every vertical video it touches — the output size is the
 * caller's real frame, and the filter is folded into the composite pass instead of costing a
 * second full re-encode.
 * @returns {string} a `zoompan=…` filter string
 */
export function zoomFilter({ index = 0, intensity = 0.5, durationSec = 7, w = 1920, h = 1080, fps = 30 } = {}) {
  const amt = Math.min(0.4, Math.max(0.02, 0.08 + Math.max(0, Math.min(1, intensity)) * 0.12));
  const zMax = 1 + amt;
  const frames = Math.max(1, Math.round(Math.max(0.5, durationSec) * fps));
  const pushIn = index % 2 === 0;
  // `on` is the output frame index, so both expressions traverse exactly one scene.
  const z = pushIn
    ? `'min(${zMax.toFixed(3)},1+${amt.toFixed(4)}*on/${frames})'`
    : `'max(1,${zMax.toFixed(3)}-${amt.toFixed(4)}*on/${frames})'`;
  const [fx, fy] = zoomFocus(['center', 'top', 'center', 'face'][index % 4]);
  return `zoompan=z=${z}:x='${fx}*(iw-iw/zoom)':y='${fy}*(ih-ih/zoom)':d=1:s=${w}x${h}:fps=${fps}`;
}

export async function compositeColorkey(scenePath, footagePath, outPath, {
  start = 0, duration, w, h, fps = 30, key = '0x050510', similarity = 0.3, blend = 0.2,
  exact = false, audioFrom = 'scene', position = 'center', zoom = null,
} = {}) {
  const footDur = await probeDuration(footagePath);
  const dur = duration || (await probeDuration(scenePath));
  const off = exact
    ? Math.max(0, Math.min(start, Math.max(0, footDur - 0.05)))
    : (footDur > 1 ? (Math.max(0, start) % Math.max(0.5, footDur - Math.min(dur, footDur * 0.5))) : 0);
  // REFRAME BIAS (P43): the bare `crop=w:h` ffmpeg default is dead-centre, which cuts a person
  // standing off to one side straight out of the shot. 'center' keeps the historic expression
  // byte-for-byte; any other position computes an explicit x.
  let cropExpr = `crop=${w}:${h}`;
  if (position && position !== 'center') {
    const size = await probeImageSize(footagePath);
    if (size?.w && size?.h) {
      // mirror `scale=…:force_original_aspect_ratio=increase`: the source is scaled up until BOTH
      // dimensions cover the output, so the scale factor is the larger of the two ratios.
      const k = Math.max(w / size.w, h / size.h);
      const scaledW = Math.round(size.w * k);
      const subjectX = position === 'auto' ? await detectSubjectX(footagePath, { at: off + 0.5 }) : null;
      cropExpr = `crop=${w}:${h}:${reframeOffsetX(position, scaledW, w, subjectX)}:0`;
    }
  }
  // AUTO ZOOM (P44): the push-in rides the FOOTAGE only — the graphics keyed on top stay put,
  // which is the whole point (a zooming overlay would just look like a rendering mistake).
  const zoomExpr = zoom ? `${zoomFilter({ ...zoom, durationSec: dur, w, h, fps })},` : '';
  await ffmpeg([
    '-ss', off.toFixed(3), '-i', footagePath, '-i', scenePath,
    '-filter_complex',
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,${cropExpr},fps=${fps},${zoomExpr}tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)},setsar=1[bg];` +
    `[1:v]colorkey=${key}:${similarity}:${blend}[fg];` +
    `[bg][fg]overlay=0:0:shortest=1[v]`,
    '-map', '[v]',
    // '0:a?' keeps the footage's own audio (edit-video); '1:a?' keeps the scene's narration.
    '-map', audioFrom === 'footage' ? '0:a?' : '1:a?', '-t', dur.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', outPath,
  ]);
  return outPath;
}
