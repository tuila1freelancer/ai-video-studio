// Functional QC tests — build tiny clips with ffmpeg and assert the integrity gate's verdicts.
// P38: the visual QC (loudness / black / white / silence scanning + quality tiers) is removed;
// what remains is cheap stream/duration integrity. Skipped when ffmpeg is not resolvable.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { PATHS } from '../src/config/paths.js';

const haveFfmpeg = !!PATHS.ffmpeg && !!PATHS.ffprobe;
const dir = mkdtempSync(join(tmpdir(), 'avs-qc-'));

async function makeClip(name, { silent }) {
  const { ffmpeg } = await import('../src/media/ffmpeg.js');
  const out = join(dir, name);
  const audio = silent ? ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'] : ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=3'];
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3', ...audio, '-t', '3',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', ...(silent ? [] : ['-af', 'volume=0.4']), out]);
  return out;
}

test('qcSceneClip passes a clip that carries both streams at the right duration', { skip: !haveFfmpeg }, async () => {
  const { qcSceneClip } = await import('../src/pipeline/qc.js');
  const clip = await makeClip('voiced.mp4', { silent: false });
  assert.equal((await qcSceneClip(clip, { expectDur: 3 })).ok, true);
  // P38: a silent-but-present audio stream is NOT a defect anymore (loudness scan removed)
  const silent = await makeClip('silent.mp4', { silent: true });
  assert.equal((await qcSceneClip(silent, { expectDur: 3 })).ok, true);
});

test('qcSceneClip enforces the A/V duration window', { skip: !haveFfmpeg }, async () => {
  const { qcSceneClip } = await import('../src/pipeline/qc.js');
  const clip = await makeClip('voiced2.mp4', { silent: false });
  const drift = await qcSceneClip(clip, { expectDur: 9 });
  assert.equal(drift.ok, false, 'a clip 6s short of its voice must fail');
});

test('qcFinalVideo integrity: a well-formed clip passes; a duration mismatch is flagged', { skip: !haveFfmpeg }, async () => {
  const { qcFinalVideo } = await import('../src/pipeline/qc.js');
  const clip = await makeClip('final.mp4', { silent: false });
  assert.equal((await qcFinalVideo(clip, { expectDur: 3 })).ok, true);
  const bad = await qcFinalVideo(clip, { expectDur: 30 });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.type === 'duration'), 'a 10x duration mismatch is flagged');
});

test('normalizeVoice lands near -16 LUFS via the measured linear pass and keeps the pad', { skip: !haveFfmpeg }, async () => {
  const { ffmpeg, normalizeVoice, measureLoudness } = await import('../src/media/ffmpeg.js');
  const quiet = join(dir, 'quiet.m4a');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-af', 'volume=0.05', '-c:a', 'aac', quiet]);
  const r = await normalizeVoice(quiet, join(dir, 'norm.m4a'), { padMs: 650 });
  assert.ok(r.duration > 2.4, 'pad must extend the duration');
  const after = await measureLoudness(join(dir, 'norm.m4a'));
  assert.ok(after && Math.abs(parseFloat(after.input_i) + 16) < 3, `should sit near -16 LUFS, got ${after?.input_i}`);
});
