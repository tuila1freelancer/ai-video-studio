// P21 — LLM sound design lane: one plan (BGM + SFX by cue sheet) validated and clamped
// deterministically; offline or an unusable plan degrades to the legacy deterministic audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCueSheet, sanitizePlan, planSoundDesign, BGM_VOL_MIN, BGM_VOL_MAX, SFX_MIN_GAP_S } from '../src/audio/sound-design.js';

const LIB = {
  bgm: [{ name: 'crypto ambient electronic minimal background', path: '/x/bgm1.mp3' },
        { name: 'finance update modern clean', path: '/x/bgm2.mp3' }],
  sfx: [{ name: 'Ding 2', path: '/x/ding.mp3' }, { name: 'booom - shock face', path: '/x/boom.mp3' }],
  total: 60,
};

test('P21 sound-design: buildCueSheet lays scene cues on the FINAL timeline (xfade loss applied)', () => {
  const scenes = [
    { duration: 10, srt_json: [{ start: 0.5, end: 2, text: 'mở đầu' }] },
    { duration: 8, srt_json: [{ start: 1, end: 3, text: 'điểm chính' }] },
  ];
  const sheet = buildCueSheet(scenes, (k) => (k === 1 ? 0.5 : 0)); // 0.5s xfade before scene 2
  assert.deepEqual(sheet.map((c) => c.t), [0.5, 10.5]); // 10 + 1 − 0.5
  assert.equal(sheet[1].text, 'điểm chính');
});

test('P21 sound-design: sanitizePlan resolves names, clamps volumes, enforces the 1s SFX gap and drops unknown files', () => {
  const plan = sanitizePlan({
    background_music: 'CRYPTO ambient electronic minimal background',
    background_volume: 0.5, // out of range → clamped
    sound_effects: [
      { file: 'Ding 2', time: 5, volume: 2.0 },       // volume clamped to 1.0
      { file: 'booom - shock face', time: 5.4, volume: 0.8 }, // <1s after previous → dropped
      { file: 'booom - shock face', time: 12, volume: 0.8 },
      { file: 'does-not-exist', time: 20, volume: 0.8 },      // unknown → dropped
      { file: 'Ding 2', time: 59.9, volume: 0.8 },            // past total-0.3 → dropped
    ],
  }, LIB);
  assert.equal(plan.bgmPath, '/x/bgm1.mp3');
  assert.ok(plan.bgmVol <= BGM_VOL_MAX && plan.bgmVol >= BGM_VOL_MIN);
  assert.deepEqual(plan.events.map((e) => e.at), [5, 12]);
  assert.ok(plan.events.every((e, i, a) => i === 0 || e.at - a[i - 1].at >= SFX_MIN_GAP_S));
  // volume 1.0 vs bed 0.75 → positive dB; sane bounds
  assert.ok(plan.events[0].gain > 0 && plan.events[0].gain < 4);
});

test('P21 sound-design: an empty/garbage plan returns null (caller keeps legacy audio)', () => {
  assert.equal(sanitizePlan(null, LIB), null);
  assert.equal(sanitizePlan({ background_music: 'nope', sound_effects: [] }, LIB), null);
});

test('P21 sound-design: offline (LLM disabled) planSoundDesign is a clean null', async () => {
  const r = await planSoundDesign({ scenes: [{ duration: 5, srt_json: [{ start: 0, end: 1, text: 'x' }] }],
    bgm: LIB.bgm, sfx: LIB.sfx, total: 5, llm: { enabled: false } });
  assert.equal(r, null);
});

test('a flaky sound-design plan is re-asked, and the fallback is real music not noise', () => {
  // One call in three came back with names matching nothing in the library. There was no retry
  // and no loud failure: two finished videos shipped with an inaudible synthetic bed and zero
  // SFX while their config said autoBgm/autoSfx were on.
  const sd = readFileSync(new URL('../src/audio/sound-design.js', import.meta.url), 'utf8');
  assert.match(sd, /const PLAN_TRIES = 3;/);
  assert.match(sd, /for \(let attempt = 1; attempt <= PLAN_TRIES; attempt\+\+\)/);

  const fin = readFileSync(new URL('../src/pipeline/stages/finalize.js', import.meta.url), 'utf8');
  assert.match(fin, /const lib = usableLibrary\(DB\.listLibrary\('bgm'\)\);/);
  assert.match(fin, /pickLibraryBgm\(projectId, lib\.length\)/);
  // deterministic, because bgmPath feeds the concat fingerprint
  assert.match(fin, /function pickLibraryBgm\(projectId, n\)/);
  const iPick = fin.indexOf('lib[pickLibraryBgm'), iBed = fin.indexOf('makeAmbientBed(bgmPath, 45)');
  assert.ok(iPick > 0 && iBed > iPick, 'the library is tried BEFORE the synthetic bed');
});
