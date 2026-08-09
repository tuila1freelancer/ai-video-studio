// Broadcast mastering — the -16 LUFS authority for the FINISHED video (P9, relocated here
// from the concat filtergraph). Two-pass: measure the mixed program, then apply a mostly-
// linear loudnorm with true-peak limiting on the AUDIO ONLY (-c:v copy), so the video is
// never re-encoded for a loudness correction. Already-compliant files are left untouched.
import { renameSync } from 'node:fs';
import { ffmpeg, measureLoudness, probeDuration } from './ffmpeg.js';

const TARGET_I = -16, TARGET_TP = -1.5, TARGET_LRA = 11;

/**
 * Master a finished video's audio to -16 LUFS / TP <= -1.5 in place.
 * @returns {{lufs:number|null, truePeak:number|null, corrected:boolean}}
 */
export async function masterAudio(file, { onLog, signal } = {}) {
  const m = await measureLoudness(file, { I: TARGET_I, TP: TARGET_TP, LRA: TARGET_LRA });
  if (!m) return { lufs: null, truePeak: null, corrected: false }; // unmeasurable → leave as-is
  const i = parseFloat(m.input_i), tp = parseFloat(m.input_tp);
  // within 0.8 LU of target and true-peak safe → already broadcast-clean, don't touch it
  if (Math.abs(i - TARGET_I) <= 0.8 && tp <= -1.0) return { lufs: i, truePeak: tp, corrected: false };

  const out = file.replace(/\.(\w+)$/, '_master.$1');
  await ffmpeg([
    '-i', file, '-c:v', 'copy',
    '-af', `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`
      + `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`
      + `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', out,
    // A remux of a whole programme is minutes of work — abortable like the join itself.
  ], { onLog, signal });
  // audio-only remux sanity: same container duration, then replace the original atomically
  const d0 = await probeDuration(file), d1 = await probeDuration(out);
  if (!d1 || Math.abs(d1 - d0) > 0.5) throw new Error(`master remux đổi thời lượng (${d0.toFixed(1)}s → ${d1.toFixed(1)}s)`);
  renameSync(out, file);
  const after = await measureLoudness(file, { I: TARGET_I, TP: TARGET_TP, LRA: TARGET_LRA });
  return {
    lufs: after ? parseFloat(after.input_i) : null,
    truePeak: after ? parseFloat(after.input_tp) : null,
    corrected: true,
  };
}
