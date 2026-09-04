// ffmpeg / ffprobe helpers.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIRS, PATHS } from '../config/paths.js';
// stop.js is dependency-free on purpose, so importing it here does not drag the pipeline (or the
// database) into the process-spawn path.
import { stopError } from '../pipeline/stop.js';

import { m, tp } from '../i18n/t.js';
// internal spawn wrapper — callers use ffmpeg()/ffmpegAss() below.
//
// `signal` is how "Dừng" reaches a running encode. A concat can occupy one ffmpeg process for a
// quarter of an hour, and the pipeline's checkpoints only fire BETWEEN steps — so without this
// the stop was honoured only once the encode had finished doing the work being cancelled.
//
// An abort is reported as a stop, not as a failure: the error carries `.stopped`, which is the
// tag the orchestrator reads to settle the run as paused. Left as a plain AbortError it would be
// classified as a crash, shown as "⛔ Pipeline lỗi", and — because it looks retryable — trigger
// the automatic resume, restarting the very render the owner just stopped.
//
// The filtergraph never travels as an argument. `ps -ax -o command` shows every argv of a running
// process to any account on the machine, and our graph IS the transition doctrine — dip lengths,
// xfade offsets, the audio seam. `-filter_complex_script` takes the same string from a file that
// lives only as long as the encode.
export function detachFilterGraph(args) {
  const i = args.indexOf('-filter_complex');
  if (i < 0 || typeof args[i + 1] !== 'string') return { args, cleanup: () => {} };
  mkdirSync(DIRS.tmp, { recursive: true });
  const file = join(DIRS.tmp, `fg-${randomBytes(8).toString('hex')}.txt`);
  writeFileSync(file, args[i + 1], 'utf8');
  const next = args.slice();
  next.splice(i, 2, '-filter_complex_script', file);
  return { args: next, cleanup: () => rmSync(file, { force: true }) };
}

function run(bin, args, { onLog, signal } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(stopError());
    const graph = detachFilterGraph(args);
    const done = (fn) => (v) => { graph.cleanup(); fn(v); };
    const resolveOnce = done(resolvePromise);
    const rejectOnce = done(reject);
    const ps = spawn(bin, graph.args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let err = '';
    ps.stdout.on('data', (d) => onLog && onLog(d.toString()));
    ps.stderr.on('data', (d) => { const s = d.toString(); err += s; onLog && onLog(s); });
    ps.on('error', (e) => rejectOnce(signal?.aborted ? stopError() : e));
    ps.on('close', (code) => {
      if (signal?.aborted) return rejectOnce(stopError());
      return code === 0 ? resolveOnce({ code, err }) : rejectOnce(new Error(`${bin} exit ${code}: ${err.slice(-600)}`));
    });
  });
}

export function ffmpeg(args, opts) { return run(PATHS.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], opts); }

// libass-capable build — required only for filters like subtitles=/ass= (image-mode burn).
export function ffmpegAss(args, opts) {
  return run(PATHS.ffmpegAss || PATHS.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], opts);
}

// Does the libass-capable binary carry drawtext (freetype)? Homebrew's ffmpeg often does
// NOT, so the text-watermark lane must both (a) check this and (b) run via ffmpegAss.
let _hasDrawtext = null;
export function hasDrawtext() {
  if (_hasDrawtext !== null) return _hasDrawtext;
  return (_hasDrawtext = new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffmpegAss || PATHS.ffmpeg, ['-hide_banner', '-filters']);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(/\bdrawtext\b/.test(out)));
    ps.on('error', () => resolvePromise(false));
  }));
}

export async function probeDuration(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(parseFloat(out.trim()) || 0));
    ps.on('error', () => resolvePromise(0));
  });
}

/** Frame rate of a clip's first video stream, or 0 when it cannot be read. */
export async function probeFrameRate(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => {
      const [n, d] = out.trim().split('/').map(Number);
      const fps = d ? n / d : n;
      resolvePromise(Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 0);
    });
    ps.on('error', () => resolvePromise(0));
  });
}

/** Intrinsic pixel size of an image (first video stream) — {w,h} or null. */
export async function probeImageSize(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => {
      const [w, h] = out.trim().split(',').map((n) => parseInt(n, 10));
      resolvePromise(w > 0 && h > 0 ? { w, h } : null);
    });
    ps.on('error', () => resolvePromise(null));
  });
}

// Brand-asset transparency gate (P27): a generated character PNG must carry a REAL alpha
// channel and its background must actually be transparent. Pixel-format check first (an
// opaque JPEG/RGB24 fails immediately), then the mean alpha of the four 8×8 corner patches
// — a character never fills all four corners, so ≥3 near-zero corners ⇔ transparent bg.
export async function verifyTransparentBg(file, { patch = 8, maxMeanAlpha = 16, minClearCorners = 3 } = {}) {
  const px = await new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(out.trim()));
    ps.on('error', () => resolvePromise(''));
  });
  // csv follows the stream section's NATURAL field order (width,height,pix_fmt) — not the request order
  const [wS, hS, fmt] = px.split(',');
  const w = parseInt(wS, 10), h = parseInt(hS, 10);
  if (!/(rgba|bgra|abgr|argb|ya8|ya16|gbrap|yuva|pal8)/.test(fmt || '') || !(w > patch && h > patch)) {
    return { ok: false, reason: `no alpha channel (pix_fmt ${fmt || '?'})` };
  }
  const corners = [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]];
  let clear = 0;
  const means = [];
  for (const [x, y] of corners) {
    const { err } = await ffmpegQuiet(['-i', file, '-vf',
      `format=rgba,alphaextract,crop=${patch}:${patch}:${x}:${y},signalstats,metadata=print`,
      '-f', 'null', '-']);
    const m = err.match(/signalstats\.YAVG=([\d.]+)/);
    const mean = m ? parseFloat(m[1]) : 255;
    means.push(Math.round(mean));
    if (mean <= maxMeanAlpha) clear++;
  }
  return clear >= minClearCorners
    ? { ok: true, corners: means }
    : { ok: false, reason: `background not transparent (corner alpha means ${means.join('/')})`, corners: means };
}

// metadata=print writes to stderr at info level — bypass the -loglevel error wrapper.
function ffmpegQuiet(args) {
  return new Promise((resolvePromise, reject) => {
    const ps = spawn(PATHS.ffmpeg, ['-y', '-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', (d) => err += d.toString());
    ps.on('error', reject);
    ps.on('close', (code) => code === 0 ? resolvePromise({ err }) : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`)));
  });
}

// Generate a solid/gradient background image sized for the aspect ratio (used when no image given).
export async function makeGradientImage(outPath, { w, h, c1 = '0x1e293b', c2 = '0x0f172a' }) {
  await ffmpeg([
    '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c1}:c1=${c2}:x0=0:y0=0:x1=${w}:y1=${h}`,
    '-frames:v', '1', outPath,
  ]);
  return outPath;
}

// Measure loudness (EBU R128) with a decode-only pass; loudnorm prints its JSON block on
// stderr at info level, so this spawns ffmpeg directly instead of using the -loglevel error
// wrapper above. Returns the measured values or null (caller falls back to single-pass).
export function measureLoudness(inPath, { I = -16, TP = -1.5, LRA = 11 } = {}) {
  return new Promise((resolve) => {
    const ps = spawn(PATHS.ffmpeg, ['-hide_banner', '-nostats', '-i', inPath,
      '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', () => resolve(null));
    ps.on('close', () => {
      const m = err.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
      if (!m) return resolve(null);
      try {
        const j = JSON.parse(m[0]);
        const ok = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']
          .every((k) => Number.isFinite(parseFloat(j[k])));
        resolve(ok ? j : null);
      } catch { resolve(null); }
    });
  });
}

// Per-scene voice conditioning: measured LINEAR loudness-normalize (EBU R128, two-pass) so
// every scene sits at the same level regardless of TTS provider — a static gain, so it cannot
// pump, and the whole-mix loudnorm at concat (the -16 LUFS authority, P9) barely has to move
// an already-correct input. Then pad a short trailing silence (the "breath" between scenes —
// reference app uses 650ms vi / 400ms en). Returns { path, duration }.
export async function normalizeVoice(inPath, outPath, { padMs = 500 } = {}) {
  const pad = Math.max(0, padMs) / 1000;
  let ln = 'loudnorm=I=-16:TP=-1.5:LRA=11'; // fallback: single-pass dynamic (previous behavior)
  const meas = await measureLoudness(inPath);
  if (meas) {
    ln += `:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}`
      + `:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`;
  }
  await ffmpeg([
    '-i', inPath,
    '-af', `${ln}${pad ? `,apad=pad_dur=${pad}` : ''}`,
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', outPath,
  ]);
  const duration = await probeDuration(outPath);
  if (!duration || duration <= pad) throw new Error(m('chuẩn hoá âm lượng thất bại (audio rỗng)'));
  return { path: outPath, duration };
}

// Make silent audio of given seconds (fallback when TTS missing).
// Overlay-mode composite (reference-app parity): the scene clip's key color becomes
// transparent and the motion graphics land on a slice of the owner's base footage. The
// slice offset wraps around the footage length so any video length works; footage shorter
// than the scene is frozen on its last frame (tpad clone) rather than cut to black.
// Scene AUDIO (the narration) is kept; the footage's own audio is dropped.
// `exact` + `audioFrom:'footage'` switch this into EDIT-VIDEO mode (P40): the graphics belong to
// one specific moment of the owner's own video, so the slice is taken at exactly `start` (never
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

export async function makeSilence(outPath, seconds) {
  await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`, '-t', String(seconds), '-c:a', 'aac', outPath]);
  return outPath;
}

// Synthesized transition whoosh (fixed seed → deterministic, fully offline): a pink-noise
// swell band-passed into the "air" range with a fast attack and long tail.
export async function makeWhoosh(outPath, { dur = 0.9 } = {}) {
  await ffmpeg([
    '-f', 'lavfi', '-i', `anoisesrc=d=${dur}:c=pink:a=0.9:seed=7:r=44100`,
    '-af', `highpass=f=240,lowpass=f=2600,afade=t=in:st=0:d=${(dur * 0.35).toFixed(2)}:curve=qsin,afade=t=out:st=${(dur * 0.4).toFixed(2)}:d=${(dur * 0.6).toFixed(2)}:curve=qsin,volume=0.9`,
    '-c:a', 'aac', '-b:a', '128k', '-ac', '1', outPath,
  ]);
  return outPath;
}

// Lay one whoosh at every event timestamp onto a silent bed of the video's length —
// mixed into the final cut like a second BGM track (section punctuation, reference-app style).
export async function makeSfxBed(outPath, { events = [], whooshPath, total = 0 }) {
  const evts = events.filter((e) => Number.isFinite(+e.at) && +e.at >= 0).slice(0, 60);
  if (!evts.length || !total) throw new Error(m('sfx bed: không có event/thời lượng'));
  const args = [];
  // per-event source + gain (Scene Studio audio director); {at}-only events keep the
  // legacy whoosh output byte-identical (no volume filter inserted)
  for (const e of evts) args.push('-i', e.src || whooshPath);
  const fc = evts.map((e, i) => {
    const vol = Number.isFinite(+e.gain) && +e.gain !== 0 ? `volume=${(+e.gain).toFixed(1)}dB,` : '';
    return `[${i}:a]${vol}adelay=${Math.round(+e.at * 1000)}:all=1[d${i}]`;
  });
  const mix = evts.map((_, i) => `[d${i}]`).join('');
  fc.push(`${mix}amix=inputs=${evts.length}:duration=longest:normalize=0,apad=whole_dur=${total.toFixed(2)}[out]`);
  await ffmpeg([...args, '-filter_complex', fc.join(';'), '-map', '[out]', '-t', total.toFixed(2),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '1', outPath]);
  return outPath;
}

// Generate a soft, consonant ambient music bed (open Cmaj9 pad) — calm, unobtrusive, loopable.
export async function makeAmbientBed(outPath, seconds = 40) {
  const notes = [130.81, 196.00, 261.63, 329.63, 392.00]; // C3 G3 C4 E4 G4
  const inputs = notes.flatMap((f) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${seconds}:sample_rate=44100`]);
  const mix = notes.map((_, i) => `[${i}]`).join('');
  const fc = `${mix}amix=inputs=${notes.length}:normalize=1,`
    + `tremolo=f=0.12:d=0.5,lowpass=f=820,highpass=f=90,`
    + `aecho=0.8:0.85:90|320:0.35|0.25,`
    + `afade=t=in:st=0:d=3,afade=t=out:st=${seconds - 3}:d=3,volume=0.7`;
  await ffmpeg(['-y', ...inputs, '-filter_complex', fc, '-t', String(seconds),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', outPath]);
  return outPath;
}
