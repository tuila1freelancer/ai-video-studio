// P21 — LLM sound design lane: one plan (BGM + SFX by cue sheet) validated and clamped
// deterministically; offline or an unusable plan degrades to the legacy deterministic audio.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
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
  const sd = sourceOf('src/audio/sound-design.js');
  assert.match(sd, /const PLAN_TRIES = 3;/);
  assert.match(sd, /for \(let attempt = 1; attempt <= PLAN_TRIES; attempt\+\+\)/);

  const fin = sourceOf('src/pipeline/stages/finalize.js');
  assert.match(fin, /const lib = usableLibrary\(DB\.listLibrary\('bgm'\)\);/);
  assert.match(fin, /pickLibraryBgm\(projectId, lib\.length\)/);
  // deterministic, because bgmPath feeds the concat fingerprint
  assert.match(fin, /function pickLibraryBgm\(projectId, n\)/);
  const iPick = fin.indexOf('lib[pickLibraryBgm'), iBed = fin.indexOf('makeAmbientBed(bgmPath, 45)');
  assert.ok(iPick > 0 && iBed > iPick, 'the library is tried BEFORE the synthetic bed');
});

test('an audio-only re-join keeps the cover the owner chose', () => {
  // Re-mixing music re-designed the thumbnail and all six platform covers, replacing a clean
  // hand-picked design with a worse one. Packaging follows the picture, not the soundtrack.
  const fin = sourceOf('src/pipeline/stages/finalize.js');
  assert.match(fin, /const keepCover = \(res\.tier === 'audio' \|\| res\.tier === 'skip'\)/);
  assert.match(fin, /const nVar = keepCover \? 0 :/, 'no variant is designed');
  assert.match(fin, /if \(aiOn && !keepCover && config\.platformCovers !== false\)/, 'no cover set is re-shot');
  assert.match(fin, /if \(keepCover\) \{ thumb = project\.thumb_path;/, 'the existing cover is carried forward');
});

test('the music and SFX levels are the raised ones, and the SFX bed cannot clip the mix', () => {
  // Measured on video 2: the old 0.11 pre-duck level put the bed at −45 dBFS in the speech gaps,
  // which reads as present on a meter and as nothing to the ear.
  assert.equal(BGM_VOL_MIN, 0.14);
  assert.equal(BGM_VOL_MAX, 0.28);
  const r = sourceOf('src/pipeline/render.js');
  assert.match(r, /\+bgmVol > 0 \? \+bgmVol : 0\.24\)/, 'no-plan default sits inside the plan range');
  assert.match(r, /volume=0\.9\[sfx\]/);
  // the SFX bed peaks near 0 dBFS by construction, so its post-gain must stay under unity
  assert.doesNotMatch(r, /volume=1(\.0+)?\[sfx\]/, 'unity or above would clip against the voice');
});
