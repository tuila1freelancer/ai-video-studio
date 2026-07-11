// Functional QC tests — build tiny clips with ffmpeg and assert the gate's verdicts.
// Skipped cleanly when ffmpeg is not resolvable (hermetic CI installs it via apt).
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

test('qcSceneClip flags a narrated scene whose audio is silent (dead-air, pre-mix voice bus)', { skip: !haveFfmpeg }, async () => {
  const { qcSceneClip } = await import('../src/pipeline/qc.js');
  const clip = await makeClip('silent.mp4', { silent: true });
  const r = await qcSceneClip(clip, { expectDur: 3, expectVoice: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cảnh câm/);
});

test('qcSceneClip passes an intentionally silent clip when no voice is expected', { skip: !haveFfmpeg }, async () => {
  const { qcSceneClip } = await import('../src/pipeline/qc.js');
  const clip = await makeClip('silent2.mp4', { silent: true });
  assert.equal((await qcSceneClip(clip, { expectDur: 3, expectVoice: false })).ok, true);
});

test('qcSceneClip passes a voiced clip and enforces the A/V duration window', { skip: !haveFfmpeg }, async () => {
  const { qcSceneClip } = await import('../src/pipeline/qc.js');
  const clip = await makeClip('voiced.mp4', { silent: false });
  assert.equal((await qcSceneClip(clip, { expectDur: 3, expectVoice: true })).ok, true);
  const drift = await qcSceneClip(clip, { expectDur: 9, expectVoice: true });
  assert.equal(drift.ok, false, 'a clip 6s short of its voice must fail');
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
