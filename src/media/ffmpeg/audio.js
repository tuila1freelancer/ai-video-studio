// Audio: loudness measurement, per-scene normalisation with the breath pad (P9), silence and the synthetic SFX/ambient beds.
import { spawn } from 'node:child_process';
import { PATHS } from '../../config/paths.js';
import { m } from '../../i18n/t.js';
import { ffmpeg } from './run.js';
import { probeDuration } from './probe.js';

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
