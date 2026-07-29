// ffmpeg / ffprobe helpers.
import { spawn } from 'node:child_process';
import { PATHS } from '../config/paths.js';

// internal spawn wrapper — callers use ffmpeg()/ffmpegAss() below.
function run(bin, args, { onLog } = {}) {
  return new Promise((resolvePromise, reject) => {
    const ps = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ps.stdout.on('data', (d) => onLog && onLog(d.toString()));
    ps.stderr.on('data', (d) => { const s = d.toString(); err += s; onLog && onLog(s); });
    ps.on('error', reject);
    ps.on('close', (code) => code === 0 ? resolvePromise({ code, err }) : reject(new Error(`${bin} exit ${code}: ${err.slice(-600)}`)));
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
  const m = await measureLoudness(inPath);
  if (m) {
    ln += `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`
      + `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  }
  await ffmpeg([
    '-i', inPath,
    '-af', `${ln}${pad ? `,apad=pad_dur=${pad}` : ''}`,
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', outPath,
  ]);
  const duration = await probeDuration(outPath);
  if (!duration || duration <= pad) throw new Error('chuẩn hoá âm lượng thất bại (audio rỗng)');
  return { path: outPath, duration };
}

// Make silent audio of given seconds (fallback when TTS missing).
// Overlay-mode composite (reference-app parity): the scene clip's key color becomes
// transparent and the motion graphics land on a slice of the owner's base footage. The
// slice offset wraps around the footage length so any video length works; footage shorter
// than the scene is frozen on its last frame (tpad clone) rather than cut to black.
// Scene AUDIO (the narration) is kept; the footage's own audio is dropped.
export async function compositeColorkey(scenePath, footagePath, outPath, {
  start = 0, duration, w, h, fps = 30, key = '0x050510', similarity = 0.3, blend = 0.2,
} = {}) {
  const footDur = await probeDuration(footagePath);
  const dur = duration || (await probeDuration(scenePath));
  const off = footDur > 1 ? (Math.max(0, start) % Math.max(0.5, footDur - Math.min(dur, footDur * 0.5))) : 0;
  await ffmpeg([
    '-ss', off.toFixed(3), '-i', footagePath, '-i', scenePath,
    '-filter_complex',
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)},setsar=1[bg];` +
    `[1:v]colorkey=${key}:${similarity}:${blend}[fg];` +
    `[bg][fg]overlay=0:0:shortest=1[v]`,
    '-map', '[v]', '-map', '1:a?', '-t', dur.toFixed(3),
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
  if (!evts.length || !total) throw new Error('sfx bed: không có event/thời lượng');
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
