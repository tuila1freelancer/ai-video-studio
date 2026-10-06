// The final-pass subtitle lane, tested where it is pure: colour conversion, timestamps, the
// karaoke line model, and the offset arithmetic that decides where every caption lands.
//
// The two things most likely to ship broken are covered first and hardest:
//   - ASS colours are BGR with an INVERTED alpha byte. Get either wrong and the burn looks
//     "washed out" or "the wrong colour" with nothing in any log.
//   - scene offsets are not cumulative durations. Every crossfade steals its own length back,
//     with a per-join clamp, so guessing drifts the subtitles further the longer the video runs.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { toAssColor, assTime, escapeAssText, applyTextCase, buildAss } from '../src/subtitles/ass.js';
import { planOffsets, programCues, buildTimeline, shiftCues, sceneCues } from '../src/subtitles/timeline.js';
import { burnStyleFrom, captionStyleFrom } from '../src/subtitles/presets.js';

const theme = { ink: '#F2F5FF', accents: ['#7C8CFF', '#22D3EE', '#F59E0B'] };
const SIZE = { w: 1920, h: 1080 };

// ---------------------------------------------------------------- colours + primitives

test('ASS colours are BGR with an inverted alpha byte', () => {
  // &HAABBGGRR — #F7B500 is R=F7 G=B5 B=00, so the payload reads 00 B5 F7
  assert.equal(toAssColor('#F7B500'), '&H0000B5F7');
  assert.equal(toAssColor('#FFFFFF'), '&H00FFFFFF');
  assert.equal(toAssColor('#000000'), '&H00000000');
  // alpha is TRANSPARENCY: 1.0 opaque → 00, 0.0 invisible → FF
  assert.equal(toAssColor('#FFFFFF', 1), '&H00FFFFFF');
  assert.equal(toAssColor('#FFFFFF', 0), '&HFFFFFFFF');
  assert.equal(toAssColor('#FFFFFF', 0.5), '&H80FFFFFF');
  // shorthand and rgba() both appear in preset data (boxBg is an rgba string)
  assert.equal(toAssColor('#0f0'), toAssColor('#00FF00'));
  assert.equal(toAssColor('rgba(17,17,17,0.85)'), '&H26111111');
  // garbage must not produce a malformed tag that would swallow the rest of the line
  assert.match(toAssColor(undefined), /^&H[0-9A-F]{8}$/);
});

test('timestamps are H:MM:SS.CC', () => {
  assert.equal(assTime(0), '0:00:00.00');
  assert.equal(assTime(3725.46), '1:02:05.46');
  assert.equal(assTime(59.999), '0:01:00.00'); // rounds to centiseconds, never emits 60s
  assert.equal(assTime(-1), '0:00:00.00');
});

test('markup in narration cannot escape into the tag parser', () => {
  assert.equal(escapeAssText('a {b} c'), 'a \\{b\\} c');
  // only \N \n \h mean anything to libass; the backslash is dropped from exactly those
  assert.equal(escapeAssText('a\\Nb'), 'aNb');
  assert.equal(escapeAssText('C:\\temp'), 'C:\\temp');
  assert.equal(escapeAssText('one\ntwo'), 'one\\Ntwo');
});

test('text case matches what the harness CSS would do', () => {
  assert.equal(applyTextCase('một câu', 'uppercase'), 'MỘT CÂU');
  assert.equal(applyTextCase('MỘT CÂU', 'lowercase'), 'một câu');
  assert.equal(applyTextCase('mỘt cÂu', 'titlecase'), 'Một Câu');
  assert.equal(applyTextCase('giữ nguyên', 'original'), 'giữ nguyên');
});

// ---------------------------------------------------------------- style resolution

test('the burn style inherits the DOM lane font SIZE, not the raw config number', () => {
  // The single most likely fidelity bug in this lane. assStyleFrom reports the config value
  // (80); the harness renders 80 × (min(w,h)/1080) × 0.72 = 58px. Burning at 80 would ship
  // subtitles 38% bigger than every preview the user ever saw.
  const cfg = { subtitleFontSize: 80, subtitlePreset: 'bold-impact' };
  const cap = captionStyleFrom(cfg, theme, SIZE);
  const burn = burnStyleFrom(cfg, theme, SIZE);
  assert.equal(burn.fontSizePx, cap.fontSizePx);
  assert.equal(burn.fontSizePx, 58);
  // and 4K scales with the frame, so the caption keeps its relative size
  assert.equal(burnStyleFrom(cfg, theme, { w: 3840, h: 2160 }).fontSizePx, 115);
});

test('the burn style names a number for every harness fallback', () => {
  // captionStyleFrom leaves these undefined and lets the page decide; a burn cannot.
  const burn = burnStyleFrom({}, theme, SIZE);
  assert.equal(burn.fontSizePx, Math.round(1080 * 0.052));
  assert.equal(burn.bottomPct, 7, 'landscape default');
  assert.equal(burnStyleFrom({}, theme, { w: 1080, h: 1920 }).bottomPct, 10, 'portrait default');
  assert.equal(burn.mode, 'karaoke');
  assert.equal(burn.font, 'Be Vietnam Pro');
});

test('the user font pick wins in the burn exactly as it does in the page', () => {
  const cfg = { subtitleFont: 'Anton', subtitlePreset: 'neon-glow' };
  assert.equal(burnStyleFrom(cfg, theme, SIZE).font, 'Anton', 'bare family — a CSS stack breaks libass');
  assert.equal(burnStyleFrom({ subtitlePreset: 'neon-glow' }, theme, SIZE).font, 'Montserrat');
});

// ---------------------------------------------------------------- the ASS document

const CUE = {
  start: 1, end: 3,
  text: 'một câu thoại',
  words: [
    { word: 'một', start: 1, end: 1.5 },
    { word: 'câu', start: 1.5, end: 2.2 },
    { word: 'thoại', start: 2.2, end: 3 },
  ],
};

test('the header maps px 1:1 by declaring the real frame as PlayRes', () => {
  const doc = buildAss([CUE], burnStyleFrom({ subtitleFont: 'Anton' }, theme, SIZE), SIZE);
  assert.match(doc, /PlayResX: 1920/);
  assert.match(doc, /PlayResY: 1080/);
  assert.match(doc, /^Style: Cap,Anton,/m);
  assert.match(doc, /YCbCr Matrix: None/, 'stops libass re-converting the colours mid-blend');
  // Bold stays off: the requested weight is met by putting the right FILE in the fontsdir,
  // not by asking libass to smear a synthetic bold over an already-black face.
  const style = /^Style: [^\n]+$/m.exec(doc)[0].split(',');
  assert.equal(style[7], '0', 'Bold');
});

test('karaoke picks out ONE word at a time, like the harness CSS', () => {
  const doc = buildAss([CUE], burnStyleFrom({ subtitlePreset: 'classic-karaoke' }, theme, SIZE), SIZE);
  const lines = doc.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(lines.length, 3, 'one line per word window');
  // window 1 covers the first word and runs to the SECOND word's start — no blink in the gap
  assert.match(lines[0], /^Dialogue: 0,0:00:01\.00,0:00:01\.50,Cap,/);
  assert.match(lines[1], /^Dialogue: 0,0:00:01\.50,0:00:02\.20,Cap,/);
  assert.match(lines[2], /^Dialogue: 0,0:00:02\.20,0:00:03\.00,Cap,/);
  // every line carries the whole cue; only the accent moves
  for (const l of lines) assert.ok(l.includes('một') && l.includes('câu') && l.includes('thoại'));
  const accent = toAssColor('#F7B500');
  assert.ok(lines[1].includes(`{\\c${accent}\\alpha&H00&}câu`), 'the spoken word is accented and opaque');
  // .capw.past = .95 behind, .capw.fut = .4 ahead — the harness opacities, restated
  assert.ok(lines[1].includes('\\alpha&H0D&}một'), 'already spoken sits at .95');
  assert.ok(lines[1].includes('\\alpha&H99&}thoại'), 'still ahead sits at .4');
});

test('plain mode burns one static line per cue', () => {
  const doc = buildAss([CUE], burnStyleFrom({ subtitleMode: 'plain' }, theme, SIZE), SIZE);
  const lines = doc.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /0:00:01\.00,0:00:03\.00/);
  assert.ok(lines[0].endsWith('một câu thoại'));
});

test('a cue with no word timings still burns', () => {
  // estimate-era rows have cues without `words`; they must not vanish from the video
  const doc = buildAss([{ start: 0, end: 2, text: 'không có timing từng từ' }], burnStyleFrom({}, theme, SIZE), SIZE);
  assert.equal(doc.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 1);
});

test('degenerate cues are dropped, not emitted as invisible lines', () => {
  const doc = buildAss([{ start: 2, end: 2, text: 'x' }, { start: 5, end: 4, text: 'y' }], burnStyleFrom({}, theme, SIZE), SIZE);
  assert.equal(doc.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 0);
});

test('the box preset paints its background through BorderStyle 3', () => {
  const doc = buildAss([CUE], burnStyleFrom({ subtitlePreset: 'boxed-news' }, theme, SIZE), SIZE);
  const style = /^Style: [^\n]+$/m.exec(doc)[0].split(',');
  assert.equal(style[15], '3', 'BorderStyle');
  // OutlineColour, not BackColour. This assertion was written from the ASS format description and
  // it was wrong: rendering a box with OutlineColour=red and BackColour=blue through this build's
  // libass produces a RED box. BackColour is the shadow colour under both border styles, so the
  // old mapping tinted the drop shadow and left every box the hardcoded black.
  assert.equal(style[5], toAssColor('rgba(17,17,17,0.85)'), 'OutlineColour is the preset box fill');
  assert.equal(style[6], toAssColor('#000000', 0.85), 'BackColour stays the shadow colour');
});

test('position presets map onto MarginV from the bottom', () => {
  const mv = (preset) => {
    const doc = buildAss([CUE], burnStyleFrom({ subtitlePreset: 'classic-karaoke', subtitlePosition: { preset } }, theme, SIZE), SIZE);
    return +(/^Style: [^\n]+$/m.exec(doc)[0].split(',')[21]);
  };
  assert.equal(mv('bot'), Math.round(1080 * 0.12));
  assert.equal(mv('mid'), Math.round(1080 * 0.45));
  assert.equal(mv('top'), Math.round(1080 * 0.80));
});

// ---------------------------------------------------------------- the timeline

test('scene offsets are cumulative when every join is a cut', () => {
  const { starts, total } = planOffsets([5, 7, 3], null);
  assert.deepEqual(starts, [0, 5, 12]);
  assert.equal(total, 15);
});

test('every crossfade steals its own length back out of the timeline', () => {
  // This is the bug the module exists to stop: three 10s clips joined by two 0.5s fades run
  // 29s, not 30, and clip 3 starts at 19 — not 20.
  const plan = [{ type: 'fade', dur: 0.5 }, { type: 'fade', dur: 0.5 }];
  const { starts, total } = planOffsets([10, 10, 10], plan);
  assert.deepEqual(starts, [0, 9.5, 19]);
  assert.equal(total, 29);
});

test('the per-join clamp is honoured, not the planned duration', () => {
  // A blend can never eat more than the incoming clip (−0.2) or the material already assembled
  // (−0.2). Asking for a 3s fade between one-second clips collapses to 0.8 then 1.0 — and the
  // third clip ends up starting at the same instant as the second, because the fade is longer
  // than the whole clip between them. Pathological, but it is what concatScenes builds, and the
  // offsets have to describe the video that actually gets made rather than a tidier one.
  const { starts, total } = planOffsets([1, 1, 10], [{ type: 'fade', dur: 3 }, { type: 'fade', dur: 3 }]);
  assert.deepEqual(starts.map((s) => +s.toFixed(3)), [0, 0.2, 0.2]);
  assert.equal(+total.toFixed(3), 10.2);

  // the ordinary case: a 0.5s default fade between clips comfortably longer than it
  const ok = planOffsets([6, 6, 6], [{ type: 'fade', dur: 0.5 }, { type: 'fade', dur: 0.5 }]);
  assert.deepEqual(ok.starts, [0, 5.5, 11]);
  assert.equal(ok.total, 17);
});

test('a mixed plan of cuts and blends lands every clip exactly', () => {
  const plan = [{ type: 'cut', dur: 0 }, { type: 'fade', dur: 0.5 }, { type: 'cut', dur: 0 }];
  const { starts, total } = planOffsets([4, 4, 4, 4], plan);
  assert.deepEqual(starts, [0, 4, 7.5, 11.5]);
  assert.equal(total, 15.5);
});

test('programCues shifts each scene onto its real start', () => {
  const scenes = [
    { id: 'a', idx: 0, voice_text: 'một hai', srt_json: [{ start: 0, end: 2, text: 'một hai', words: [{ word: 'một', start: 0, end: 1 }, { word: 'hai', start: 1, end: 2 }] }] },
    { id: 'b', idx: 1, voice_text: 'ba bốn', srt_json: [{ start: 0, end: 2, text: 'ba bốn', words: [{ word: 'ba', start: 0, end: 1 }, { word: 'bốn', start: 1, end: 2 }] }] },
  ];
  const { starts, total } = planOffsets([5, 5], [{ type: 'fade', dur: 0.5 }]);
  const cues = programCues(scenes, starts, {}, total);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[1].start, 4.5, 'scene 2 begins where the crossfade begins, not at 5');
  assert.equal(cues[1].words[1].start, 5.5, 'word timings travel with the cue');
});

test('a caption never outlives its own scene slot', () => {
  // libass stacks simultaneous lines — an over-running caption would put two rows of subtitles
  // on screen at every crossfade.
  const scenes = [
    { id: 'a', idx: 0, srt_json: [{ start: 0, end: 6, text: 'dài quá', words: [{ word: 'dài', start: 0, end: 3 }, { word: 'quá', start: 3, end: 6 }] }] },
    { id: 'b', idx: 1, srt_json: [{ start: 0, end: 2, text: 'kế tiếp', words: [{ word: 'kế', start: 0, end: 1 }, { word: 'tiếp', start: 1, end: 2 }] }] },
  ];
  const { starts, total } = planOffsets([5, 5], null);
  const cues = programCues(scenes, starts, {}, total);
  assert.equal(cues[0].end, 5, 'clipped to the next scene start');
  assert.ok(cues[0].words.every((w) => w.end <= 5));
  assert.equal(cues[1].start, 5);
});

test('subtitles turned off produce no cues at all', () => {
  const scenes = [{ id: 'a', idx: 0, srt_json: [{ start: 0, end: 2, text: 'x', words: [{ word: 'x', start: 0, end: 2 }] }] }];
  assert.equal(programCues(scenes, [0], { enableSubtitles: false }, 5).length, 0);
  assert.equal(sceneCues(scenes[0], { enableSubtitles: false }).length, 0);
});

test('display re-chunking reaches the burn lane too', () => {
  const scene = {
    id: 'a', idx: 0, voice_text: 'một hai ba bốn năm sáu',
    srt_json: [{
      start: 0, end: 6, text: 'một hai ba bốn năm sáu',
      words: 'một hai ba bốn năm sáu'.split(' ').map((w, i) => ({ word: w, start: i, end: i + 1 })),
    }],
  };
  assert.equal(sceneCues(scene, {}).length, 1, 'auto keeps the engine cue');
  assert.equal(sceneCues(scene, { subtitleChunk: 'words', subtitleWordsPerCue: 2 }).length, 3);
});

test('shiftCues leaves the source untouched', () => {
  const src = [{ start: 1, end: 2, text: 'x', words: [{ word: 'x', start: 1, end: 2 }] }];
  const out = shiftCues(src, 10);
  assert.equal(out[0].start, 11);
  assert.equal(src[0].start, 1, 'no mutation — the stored srt_json is the canonical truth');
  assert.equal(src[0].words[0].start, 1);
});

test('the stored timeline is what the UI maps a click back through', () => {
  const scenes = [{ id: 'a', idx: 0 }, { id: 'b', idx: 1 }];
  const { starts } = planOffsets([5, 5], [{ type: 'fade', dur: 0.5 }]);
  assert.deepEqual(buildTimeline(scenes, starts, [5, 5]), [
    { sceneId: 'a', idx: 0, start: 0, end: 5 },
    { sceneId: 'b', idx: 1, start: 4.5, end: 9.5 },
  ]);
});
