// Final integrity gate (B8) — a lightweight check before a video may be called "done".
// P38: the heavy per-frame visual QC (black/white-frame detection + dead-air silence scanning,
// scene-attributable repair cycles, and per-scene quality tiers) is REMOVED as redundant: it cost
// renders and flagged nothing a viewer would notice. What survives is
// cheap stream/duration integrity: a broken JOIN (missing stream, wildly wrong duration) is not
// "visual QC", and codegen-time renderValidate already guarantees each scene is not-broken.
import { spawn } from 'node:child_process';
import { PATHS } from '../config/paths.js';
import { probeDuration } from '../media/ffmpeg.js';

import { m, tp } from '../i18n/t.js';
export function probeStreams(file) {
  return new Promise((resolve) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
    let out = '';
    ps.stdout.on('data', (d) => { out += d.toString(); });
    ps.on('close', () => {
      // csv writer emits a trailing comma per row ("video,") — strip it before comparing
      const types = out.trim().split(/\n+/).map((s) => s.trim().replace(/,+$/, ''));
      resolve({ hasVideo: types.includes('video'), hasAudio: types.includes('audio') });
    });
    ps.on('error', () => resolve({ hasVideo: false, hasAudio: false }));
  });
}

/**
 * Integrity-check the final video. Returns { ok, duration, expectDur, issues:[{type, detail}] }.
 *  - no-video / no-audio: the joined file must carry both streams
 *  - duration:            |got − expect| ≤ tolerancePct
 * No per-frame pixel or silence scanning (P38 — dropped as redundant QC).
 */
export async function qcFinalVideo(path, { expectDur = 0, tolerancePct = 8 } = {}) {
  const issues = [];
  const duration = await probeDuration(path);
  const { hasAudio, hasVideo } = await probeStreams(path);
  if (!hasVideo) issues.push({ type: 'no-video', detail: m('video ghép không có video stream'), sceneIdx: null });
  if (!hasAudio) issues.push({ type: 'no-audio', detail: m('video ghép không có audio stream'), sceneIdx: null });
  if (expectDur > 0 && duration > 0) {
    const drift = Math.abs(duration - expectDur) / expectDur * 100;
    if (drift > tolerancePct) {
      issues.push({ type: 'duration', detail: tp`thời lượng ${duration.toFixed(1)}s lệch ${drift.toFixed(1)}% so với kỳ vọng ${expectDur.toFixed(1)}s`, sceneIdx: null });
    }
  }
  return { ok: issues.length === 0, duration, expectDur, issues };
}

// Per-scene clip integrity used in B6 verification: exists → probes → carries BOTH streams →
// A/V duration matches the voice. P38: the mean-loudness (dead-air) probe is removed along with
// the rest of the QC scanning; stream + duration presence is the cheap integrity that stays and
// still catches a genuinely broken render before it reaches concat.
export async function qcSceneClip(path, { expectDur = 0 } = {}) {
  const dur = await probeDuration(path);
  if (!dur || dur < 0.4) return { ok: false, reason: tp`thời lượng bất thường (${(dur || 0).toFixed(2)}s)` };
  const { hasAudio, hasVideo } = await probeStreams(path);
  if (!hasVideo) return { ok: false, reason: m('thiếu video stream') };
  if (!hasAudio) return { ok: false, reason: m('cảnh câm — thiếu audio stream') };
  if (expectDur > 0 && Math.abs(dur - expectDur) > Math.max(0.5, expectDur * 0.12)) {
    return { ok: false, reason: tp`A/V lệch: clip ${dur.toFixed(2)}s vs voice ${expectDur.toFixed(2)}s` };
  }
  return { ok: true };
}
