// Final quality gate (B8) — the last check before a video may be called "done".
// Duration alone is not quality: this gate decodes the finished video and hunts the defects
// a viewer would actually see — black frames, dead-air silence, missing audio — and maps each
// hit back to the scene that produced it so the runner can re-render exactly that scene.
import { spawn } from 'node:child_process';
import { PATHS } from '../config/paths.js';
import { probeDuration } from '../media/ffmpeg.js';

// Run ffmpeg decode-only with detect filters; detect filters report on stderr.
function detectPass(file, { vf, af } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostats', '-i', file,
      ...(vf ? ['-vf', vf] : ['-vn']),
      ...(af ? ['-af', af] : ['-an']),
      '-f', 'null', '-'];
    const ps = spawn(PATHS.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', reject);
    ps.on('close', () => resolve(err)); // non-zero exit still carries useful stderr
  });
}

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

const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

// Mean loudness of a file's audio via volumedetect (reports on stderr at info level).
// Returns dBFS (negative) or null when unmeasurable.
export async function measureMeanVolume(file) {
  const err = await detectPass(file, { af: 'volumedetect' }).catch(() => '');
  const m = err.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? num(m[1]) : null;
}

function sceneAt(t, sceneSpans) {
  // exact containment first — a defect STARTING on a boundary belongs to the scene that
  // starts there, not the one that just ended
  for (const s of sceneSpans) if (t >= s.t0 && t < s.t1) return s.idx;
  for (const s of sceneSpans) if (t >= s.t0 - 0.75 && t < s.t1 + 0.75) return s.idx;
  return null;
}

/**
 * QC the final video. Returns { ok, duration, issues:[{type, detail, t, sceneIdx}] }.
 *  - duration:  |got − expect| ≤ tolerancePct (+ outro allowance handled by caller's expect)
 *  - black:     any stretch ≥1.2s at ≥98% black pixels
 *  - silence:   any stretch ≥ silenceDur (default 3s) under −45dB — a video narrated wall-to-wall
 *               must never go quiet for seconds (voice + bgm both missing = defect)
 *  - no-audio:  the file must carry an audio stream at all
 * sceneSpans: [{idx, t0, t1}] in final-video seconds — maps defects to scenes for repair.
 */
export async function qcFinalVideo(path, { expectDur = 0, tolerancePct = 5, sceneSpans = [], silenceDur = 3, tailAllowance = 0 } = {}) {
  const issues = [];
  const duration = await probeDuration(path);
  const { hasAudio, hasVideo } = await probeStreams(path);
  if (!hasVideo) issues.push({ type: 'no-video', detail: 'video ghép không có video stream', t: 0, sceneIdx: null });
  if (!hasAudio) issues.push({ type: 'no-audio', detail: 'video ghép không có audio stream', t: 0, sceneIdx: null });
  if (expectDur > 0 && duration > 0) {
    const drift = Math.abs(duration - expectDur) / expectDur * 100;
    if (drift > tolerancePct) {
      issues.push({ type: 'duration', detail: `thời lượng ${duration.toFixed(1)}s lệch ${drift.toFixed(1)}% so với kỳ vọng ${expectDur.toFixed(1)}s`, t: 0, sceneIdx: null });
    }
  }

  // black frames — a rendered-but-empty scene shows up here. pix_th=0.04: dark-theme
  // backgrounds (#0A0E1A ≈ 5.5% luma) must NOT count as black; true black (≤4%) still does.
  const vErr = await detectPass(path, { vf: 'blackdetect=d=1.5:pic_th=0.99:pix_th=0.04' });
  for (const m of vErr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    const t = num(m[1]);
    issues.push({ type: 'black', detail: `màn hình đen ${num(m[3])?.toFixed(1)}s tại ${t?.toFixed(1)}s`, t, sceneIdx: sceneAt(t, sceneSpans) });
  }
  // P35 — WHITE/blank frames (the reference app's white-scene bug class: raw LLM reasoning
  // saved as HTML renders a blank white page). negate turns near-white into near-black, so
  // the same battle-tested detector finds them; dark themes can never false-positive here.
  const wErr = await detectPass(path, { vf: 'negate,blackdetect=d=1.5:pic_th=0.99:pix_th=0.06' });
  for (const m of wErr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    const t = num(m[1]);
    issues.push({ type: 'white', detail: `màn hình trắng/trống ${num(m[3])?.toFixed(1)}s tại ${t?.toFixed(1)}s`, t, sceneIdx: sceneAt(t, sceneSpans) });
  }

  // dead air — voice missing / muted scene audio
  if (hasAudio) {
    const aErr = await detectPass(path, { af: `silencedetect=noise=-45dB:d=${silenceDur}` });
    const starts = [...aErr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => num(m[1]));
    const durs = [...aErr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => num(m[1]));
    starts.forEach((t, i) => {
      // trailing fade-out + silent outro card at the very end are by design, not dead air
      if (duration && t != null && t > duration - (Math.max(4, silenceDur + 1) + tailAllowance)) return;
      issues.push({ type: 'silence', detail: `khoảng câm ${durs[i] != null ? durs[i].toFixed(1) : '?'}s tại ${t?.toFixed(1)}s`, t, sceneIdx: sceneAt(t, sceneSpans) });
    });
  }

  return { ok: issues.length === 0, duration, expectDur, issues };
}

// Summarize the per-scene visual quality tiers B5 persisted on scene.props.qtier, so the
// finalize gate can SURFACE degraded/unverified scenes instead of shipping a silent "green".
//   premium    — rendered clean by the headless validator
//   repaired   — shipped after a deterministic contrast fix (or a fallback-model rescue)
//   imperfect  — a real bespoke scene kept with a residual cosmetic geometry warning
//   fallback   — dropped to a generic heuristic template (below the bespoke bar)
//   unverified — no headless verdict (Chrome-less run) — must never read as fully verified
export function summarizeVisualTiers(scenes) {
  const rows = (scenes || [])
    .map((s) => ({ idx: s.idx, tier: (s.props && s.props.qtier) || (s.template === 'hyperframe' ? 'premium' : null) }))
    .filter((r) => r.tier);
  const degraded = rows.filter((r) => r.tier === 'imperfect' || r.tier === 'fallback');
  const unverified = rows.filter((r) => r.tier === 'unverified');
  return {
    tiers: rows,
    degraded,
    unverified,
    visualQc: unverified.length ? 'skipped' : 'verified', // 'skipped' → never claim full verification
    ok: degraded.length === 0 && unverified.length === 0,
  };
}

// Per-scene clip check used in B6 verification: exists → probes → carries BOTH streams.
// expectVoice: the scene has narration (voice_text + audio_path), so the clip's audio must
// actually CARRY speech — stream presence alone is not enough. Scene clips are the pre-mix
// voice bus (BGM only joins at concat), so a near-silent mean here means the narration is
// missing even though the final mixed video would stay above the silencedetect floor.
export async function qcSceneClip(path, { expectDur = 0, expectVoice = false } = {}) {
  const dur = await probeDuration(path);
  if (!dur || dur < 0.4) return { ok: false, reason: `thời lượng bất thường (${dur.toFixed(2)}s)` };
  const { hasAudio, hasVideo } = await probeStreams(path);
  if (!hasVideo) return { ok: false, reason: 'thiếu video stream' };
  if (!hasAudio) return { ok: false, reason: 'cảnh câm — thiếu audio stream' };
  if (expectDur > 0 && Math.abs(dur - expectDur) > Math.max(0.5, expectDur * 0.12)) {
    return { ok: false, reason: `A/V lệch: clip ${dur.toFixed(2)}s vs voice ${expectDur.toFixed(2)}s` };
  }
  if (expectVoice) {
    const mean = await measureMeanVolume(path);
    // normalized speech sits around −20 dB mean; digital silence reads ≈ −91 dB
    if (mean != null && mean < -50) {
      return { ok: false, reason: `cảnh câm — có audio stream nhưng không có tiếng đọc (mean ${mean.toFixed(1)}dB)` };
    }
  }
  return { ok: true };
}
