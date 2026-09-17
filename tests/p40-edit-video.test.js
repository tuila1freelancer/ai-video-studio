// P40-E — edit video: motion graphics onto footage the owner already has. Pins the two things
// that make the lane correct rather than merely present: the segments TILE the source exactly
// (so every scene composites onto its own moment with no drift) and the footage keeps its own
// audio. Pure/fast: no whisper, no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { ratioOf, segmentTranscript, scenesFromSegments, repairTranscript, isEditVideo } from '../src/pipeline/edit-video.js';


// whisper phrases, the shape the lane actually consumes
const PHRASES = [
  { start: 0.2, end: 4.6, text: 'Tập trung giải quyết chúng trước khi làm việc khác.' },
  { start: 4.6, end: 8.1, text: 'Kỷ luật nhỏ tạo nên bước tiến lớn.' },
  { start: 8.1, end: 11.4, text: 'Bạn sẵn sàng bứt phá giới hạn chưa?' },
  { start: 11.4, end: 15.0, text: 'Bắt đầu ngay sáng mai nhé.' },
];

test('P40-E: the source aspect ratio is read from its real pixels', () => {
  assert.equal(ratioOf(1920, 1080), '16:9');
  assert.equal(ratioOf(1080, 1920), '9:16');
  assert.equal(ratioOf(1080, 1080), '1:1');
  assert.equal(ratioOf(1080, 1350), '4:5');
  assert.equal(ratioOf(0, 0), '16:9', 'an unreadable probe still yields a usable default');
});

test('P40-E: segments TILE the source — no gap, no overlap, no lost tail', () => {
  const segs = segmentTranscript(PHRASES, { target: 5, total: 16 });
  assert.ok(segs.length >= 2, `expected several scenes, got ${segs.length}`);
  assert.equal(segs[0].start, 0, 'the silent head belongs to the first scene');
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].start, segs[i - 1].end, `scene ${i} must start exactly where ${i - 1} ended`);
  }
  assert.equal(segs[segs.length - 1].end, 16, 'the silent tail belongs to the last scene');
  // cumulative durations == the source timeline, which is what the composite offset relies on
  const sum = segs.reduce((a, s) => a + (s.end - s.start), 0);
  assert.ok(Math.abs(sum - 16) < 1e-6, `durations must sum to the source length, got ${sum}`);
});

test('P40-E: word-level input works too, and a scrap tail is merged rather than shipped', () => {
  const words = [];
  for (let i = 0; i < 24; i++) words.push({ start: i * 0.5, end: i * 0.5 + 0.45, word: i % 8 === 7 ? `w${i}.` : `w${i}` });
  const segs = segmentTranscript(words, { target: 4, total: 12 });
  assert.ok(segs.every((s) => s.end - s.start >= 3 - 1e-9), `no scene under the 3s floor: ${segs.map((s) => (s.end - s.start).toFixed(2))}`);
  // a single very short file still yields exactly one usable scene
  const tiny = segmentTranscript([], { total: 2 });
  assert.equal(tiny.length, 1);
  assert.deepEqual([tiny[0].start, tiny[0].end], [0, 2]);
  assert.deepEqual(segmentTranscript([], { total: 0 }), [], 'nothing in, nothing out');
});

test('P40-E: silent footage is still cut into even chapters so it gets graphics', () => {
  const segs = segmentTranscript([], { target: 7, total: 21 });
  assert.equal(segs.length, 3);
  assert.equal(segs[2].end, 21);
  assert.ok(segs.every((s) => s.text === ''), 'no speech → no narration text, but a scene all the same');
});

test('P40-E: each scene carries its transcript and caption cues rebased to its own zero', () => {
  const segs = segmentTranscript(PHRASES, { target: 5, total: 16 });
  const rows = scenesFromSegments(segs);
  assert.equal(rows.length, segs.length);
  for (const r of rows) {
    assert.ok(r._duration > 0);
    assert.ok(Array.isArray(r._srt));
    for (const cue of r._srt) {
      assert.ok(cue.start >= 0, 'a cue can never start before its own scene');
      assert.ok(cue.end <= r._duration + 0.5, `cue ${cue.end} must fit inside the ${r._duration}s scene`);
    }
  }
  assert.match(rows[0].voice, /Tập trung/, 'the transcript becomes the scene narration');
});

test('P40-E: a transcript repair that changes the line count is rejected wholesale', async () => {
  const realFetch = globalThis.fetch;
  const reply = (content) => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  });
  const llm = { enabled: true, apiKey: 'k', baseUrl: 'http://127.0.0.1:1/v1/chat/completions', model: 'm' };
  try {
    globalThis.fetch = async () => reply(JSON.stringify(['một', 'hai']));           // wrong count (3 in)
    const bad = await repairTranscript(PHRASES.slice(0, 3), { llm });
    assert.deepEqual(bad, PHRASES.slice(0, 3), 'a mismatched reply must not desync the video');

    globalThis.fetch = async () => reply(JSON.stringify(['một', 'hai', 'ba']));      // right count
    const good = await repairTranscript(PHRASES.slice(0, 3), { llm });
    assert.deepEqual(good.map((s) => s.text), ['một', 'hai', 'ba']);
    assert.deepEqual(good.map((s) => s.start), PHRASES.slice(0, 3).map((s) => s.start), 'timings are never touched');

    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await repairTranscript(PHRASES.slice(0, 2), { llm }), PHRASES.slice(0, 2), 'a failure keeps the raw transcript');
  } finally { globalThis.fetch = realFetch; }
  // no LLM at all → untouched, no call attempted
  assert.deepEqual(await repairTranscript(PHRASES, { llm: { enabled: false } }), PHRASES);
});

test('P40-E: an edit project keeps the footage audio and its exact source moment', () => {
  assert.equal(isEditVideo({ editVideo: { source: '/a.mp4' } }), true);
  assert.equal(isEditVideo({}), false);
  assert.equal(isEditVideo(null), false);
  // the composite must slice at `start` (never wrapped) and map the FOOTAGE audio
  const ff = sourceOf('src/media/ffmpeg.js');
  assert.match(ff, /exact = false, audioFrom = 'scene'/, 'plain overlay mode keeps its historic behaviour');
  assert.match(ff, /audioFrom === 'footage' \? '0:a\?' : '1:a\?'/, 'edit mode keeps the original soundtrack');
  const anim = sourceOf('src/animation/index.js');
  assert.match(anim, /const edit = config\.overlay\.mode === 'edit'/);
  assert.match(anim, /exact: edit, audioFrom: edit \? 'footage' : 'scene'/);
});

test('P40-E: the lane runs through the ordinary pipeline, so stop/resume/queue apply', () => {
  const runner = sourceOf('src/pipeline/runner.js');
  assert.match(runner, /if \(isEditVideo\(config\)\)/, 'routed inside runPipeline, not as a second pipeline');
  const lane = sourceOf('src/pipeline/edit-video.js');
  assert.match(lane, /granularity: 'segment'/, 'decoding accuracy beats karaoke granularity when the transcript IS the content');
  assert.match(lane, /autoBgm: false, soundDesign: false/, 'never mix our audio over the owner\'s');
  assert.match(lane, /if \(!existing\.length\)/, 'a resumed run does not re-transcribe');
});

test('P40-E: edit mode annotates the footage, and reserves NO band for its subtitles', async () => {
  const { overlayBlock } = await import('../src/hyperframe/prompt.js');
  const plain = overlayBlock();
  const edit = overlayBlock({ edit: true });
  assert.ok(!/OWNER'S OWN VIDEO/.test(plain), 'plain overlay (B-roll under a narrated scene) is unchanged');
  assert.match(edit, /they never restate the sentence/, 'annotate the footage, do not repeat it');
  // P41 (owner order): an EVEN frame outranks dodging whatever text the footage burned in —
  // no band may be reserved here, or the composition gets squeezed into the middle again.
  for (const b of [plain, edit]) assert.ok(!/KEEP THE BOTTOM/.test(b), 'no reserved band');
  // both keep the shared overlay rules
  for (const b of [plain, edit]) assert.match(b, /KEEP THE CENTER ~40-50% OF THE FRAME CLEAR/);
  assert.match(sourceOf('src/pipeline/stages/visuals.js'), /config\.overlay\.mode === 'edit' \? 'edit' : true/);
});
