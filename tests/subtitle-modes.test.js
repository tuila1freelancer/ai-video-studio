// P29 subtitle display modes + P30 font fidelity.
// P29: plain (non-karaoke) display and sentence/N-word re-chunking are PRESENTATION-layer
// rebuilds from the canonical word timestamps — every produced cue starts/ends exactly on
// real word times, so subtitles stay glued to the voice in every mode.
// P30: the picked subtitle font reaches BOTH renderers (harness captions get the family,
// libass gets a bare family name — never a CSS stack), and the page carries a loud
// document.fonts probe for the picked subtitle + brand families.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rechunkCues, splitSentences } from '../src/subtitles/chunk.js';
import { captionStyleFrom, assStyleFrom, familyName } from '../src/subtitles/presets.js';
import { buildSceneHtml } from '../src/animation/index.js';

// timed words for the narration "Xin chào các bạn. Hôm nay học AI nhé!" (0.4s each; the
// spoken stream carries one word fewer than the text's token count — realistic drift)
function words8() {
  return ['Xin', 'chào', 'các', 'bạn.', 'Hôm', 'nay', 'học', 'nhé!'].map((w, i) => ({
    word: w, start: +(i * 0.4).toFixed(2), end: +((i + 1) * 0.4).toFixed(2),
  }));
}
const asCues = (ws) => [{ start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.word).join(' '), words: ws }];

test('P29 splitSentences: Vietnamese narration splits on strong punctuation', () => {
  assert.deepEqual(splitSentences('Xin chào các bạn. Hôm nay học AI nhé!'),
    ['Xin chào các bạn.', 'Hôm nay học AI nhé!']);
  assert.deepEqual(splitSentences('Một câu không dấu chấm cuối'), ['Một câu không dấu chấm cuối']);
});

test('P29 rechunk words-mode: N-word cues on exact word timestamps, orphan merged', () => {
  const ws = words8();
  const cues = rechunkCues(asCues(ws), { chunk: 'words', wordsPerCue: 3 });
  // 8 words / 3 → 3+3+2 (the lone 8th word merges back)
  assert.deepEqual(cues.map((c) => c.words.length), [3, 3, 2]);
  for (const c of cues) {
    assert.equal(c.start, c.words[0].start, 'cue starts on its first word');
    assert.equal(c.end, c.words[c.words.length - 1].end, 'cue ends on its last word');
  }
  assert.equal(cues[2].text, 'học nhé!');
});

test('P29 rechunk sentence-mode: one cue per narration sentence, timing from the words', () => {
  const ws = words8();
  const cues = rechunkCues(asCues(ws), { chunk: 'sentence', text: 'Xin chào các bạn. Hôm nay học AI nhé!' });
  // sentence 2 has 5 tokens (Hôm nay học AI nhé) but only 4 timed words remain — the last
  // sentence absorbs the remainder, so nothing is dropped and nothing is invented
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Xin chào các bạn.');
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, ws[3].end);
  assert.equal(cues[1].start, ws[4].start);
  assert.equal(cues[1].end, ws[7].end);
  const totalWords = cues.reduce((a, c) => a + c.words.length, 0);
  assert.equal(totalWords, 8, 'every timed word is displayed exactly once');
});

test('P29 rechunk: auto passes through untouched; word-less cues stay as-is', () => {
  const cues = asCues(words8());
  assert.equal(rechunkCues(cues, { chunk: 'auto' }), cues, 'same reference');
  const estimateEra = [{ start: 0, end: 2, text: 'không có words' }];
  assert.equal(rechunkCues(estimateEra, { chunk: 'sentence', text: 'x.' }), estimateEra);
});

test('P30 familyName: CSS stacks and quotes normalize to the bare family', () => {
  assert.equal(familyName("'Anton', sans-serif"), 'Anton');
  assert.equal(familyName('Be Vietnam Pro'), 'Be Vietnam Pro');
  assert.equal(familyName('"JetBrains Mono", ui-monospace, Menlo'), 'JetBrains Mono');
  assert.equal(familyName(''), '');
});

test('P30 captionStyleFrom: the picked subtitle font reaches the harness captions', () => {
  const theme = { accents: ['#fff'] };
  // no preset: the pick still lands (this was the silent-fallback bug)
  const noPreset = captionStyleFrom({ subtitleFont: 'Anton' }, theme, { w: 1080, h: 1920 });
  assert.equal(noPreset.fontFamily, "'Anton', -apple-system, sans-serif");
  // with a preset: the explicit pick BEATS the preset stack
  const withPreset = captionStyleFrom({ subtitleFont: "'Oswald', sans-serif", subtitlePreset: 'classic-karaoke' }, theme, { w: 1080, h: 1920 });
  assert.match(withPreset.fontFamily, /^'Oswald'/);
  // untouched configs keep the historic shape (no fontFamily key invented)
  assert.equal('fontFamily' in captionStyleFrom({}, theme, { w: 1080, h: 1920 }), false);
});

test('P30 assStyleFrom: bare family for libass, plain mode disables karaoke, chunk rides along', () => {
  const s = assStyleFrom({ subtitleFont: "'Anton', sans-serif", subtitleMode: 'plain', subtitleChunk: 'words', subtitleWordsPerCue: 6 });
  assert.equal(s.font, 'Anton');
  assert.equal(s.karaoke, false);
  assert.equal(s.chunk, 'words');
  assert.equal(s.wordsPerCue, 6);
  assert.equal(assStyleFrom({}).karaoke, true, 'default stays karaoke');
});

test('P29+P30 page build: plain/sentence flags, re-chunked captions and font probes ride into the page', () => {
  const scene = {
    idx: 0, voice_text: 'Xin chào các bạn. Hôm nay học AI nhé!', duration: 6,
    template: 'kinetic-statement', props: { heading: 'X' }, srt_json: asCues(words8()),
  };
  const project = { aspect_ratio: '16:9', title: 't' };
  const cfg = {
    visualMode: 'hyperframe', subtitleMode: 'plain', subtitleChunk: 'sentence',
    subtitleFont: 'Anton', fonts: { display: 'Oswald' },
  };
  const html = buildSceneHtml(scene, project, cfg, {});
  assert.match(html, /class="cap plain wrap"/, 'plain + wrap classes on the caption bar');
  assert.match(html, /"capMode":"plain"/);
  assert.match(html, /"capWrap":true/);
  assert.match(html, /"fontChecks":\["Anton","Oswald"\]/, 'loud-font probe list');
  assert.match(html, /font-family:'Anton', -apple-system, sans-serif/, 'caption bar uses the picked family');
  assert.match(html, /"text":"Xin chào các bạn\."/, 'captions re-chunked per sentence');
  // defaults stay karaoke with the historic single-line bar
  const html2 = buildSceneHtml(scene, project, { visualMode: 'hyperframe' }, {});
  assert.match(html2, /class="cap"/);
  assert.match(html2, /"capMode":"karaoke"/);
});
