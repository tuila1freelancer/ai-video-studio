// ffmpeg / ffprobe helpers.
import { spawn } from 'node:child_process';
import { PATHS } from '../config/paths.js';

export function run(bin, args, { onLog } = {}) {
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

export async function probeDuration(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(parseFloat(out.trim()) || 0));
    ps.on('error', () => resolvePromise(0));
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

// Per-scene voice conditioning: loudness-normalize (EBU R128) so every scene sits at the same
// level regardless of TTS provider, then pad a short trailing silence (the "breath" between
// scenes — reference app uses 650ms vi / 400ms en). Returns { path, duration }.
export async function normalizeVoice(inPath, outPath, { padMs = 500 } = {}) {
  const pad = Math.max(0, padMs) / 1000;
  await ffmpeg([
    '-i', inPath,
    '-af', `loudnorm=I=-16:TP=-1.5:LRA=11${pad ? `,apad=pad_dur=${pad}` : ''}`,
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', outPath,
  ]);
  const duration = await probeDuration(outPath);
  if (!duration || duration <= pad) throw new Error('chuẩn hoá âm lượng thất bại (audio rỗng)');
  return { path: outPath, duration };
}

// Make silent audio of given seconds (fallback when TTS missing).
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
  for (let i = 0; i < evts.length; i++) args.push('-i', whooshPath);
  const fc = evts.map((e, i) => `[${i}:a]adelay=${Math.round(+e.at * 1000)}:all=1[d${i}]`);
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
