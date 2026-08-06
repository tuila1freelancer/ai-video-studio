// A byte-level fence around the scene page.
//
// Captions live INSIDE the scene page today (harness `.cap` / `#capText`), so the final-pass
// subtitle lane has to touch that page. Every finished video on disk was rendered by the code
// as it stands right now: if the page shifts by one character for a config that did not ask for
// the new lane, every clip silently stops matching its own render fingerprint and the next
// resume re-renders the lot.
//
// The hashes below were captured on 2026-08-06, before `subtitleLane` existed. They are not a
// style preference — they are the contract that says "the default path did not move".
//
// @font-face blocks are stripped before hashing. Font DELIVERY is deliberately allowed to change
// (the vendored css is being cut down from all-families-always to only-what-the-scene-uses);
// what must not change is the markup, the caption CSS, and the scene data payload.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSceneHtml } from '../src/animation/index.js';

const project = { id: 'goldenproj', aspect_ratio: '16:9' };
const scene = {
  id: 's1', idx: 0, voice_text: 'Một câu thoại mẫu để kiểm tra phụ đề',
  template: 'kinetic-statement',
  props: { pre: 'MỞ ĐẦU', heading: 'GOLDEN', heading2: '', sub: 'phụ đề mẫu' },
  duration: 6,
  srt_json: [{
    start: 0, end: 2, text: 'Một câu thoại',
    words: [{ word: 'Một', start: 0, end: 0.4 }, { word: 'câu', start: 0.4, end: 0.9 }, { word: 'thoại', start: 0.9, end: 2 }],
  }],
};

const strip = (html) => html.replace(/@font-face\s*\{[^}]*\}/g, '');
const hash = (html) => createHash('sha256').update(strip(html)).digest('hex').slice(0, 32);
const page = (config) => buildSceneHtml(scene, project, config, { total: 3 });

const GOLDEN = {
  plain: '5a748272d4b1c70b524c17746d4dd767',
  styled: '3605f4dcb6965ddeb59f72b5ba84b660',
  off: '2371e13435e7c665c1bb5e9174d5cbd3',
};
const STYLED = {
  enableSubtitles: true, subtitlePreset: 'bold-impact', subtitleFont: 'Anton', subtitleFontSize: 80,
  subtitleTextCase: 'uppercase', subtitlePosition: { preset: 'mid' }, subtitleMode: 'karaoke',
};

test('the default scene page has not moved one byte', () => {
  assert.equal(hash(page({ enableSubtitles: true })), GOLDEN.plain);
  assert.equal(hash(page(STYLED)), GOLDEN.styled);
  assert.equal(hash(page({ enableSubtitles: false })), GOLDEN.off);
});

test('the caption layer is present and driven by the config today', () => {
  // Establishes what the final-pass lane will later have to REMOVE, so the two halves of the
  // change can be read against each other.
  const html = page(STYLED);
  assert.match(html, /<div class="cap[^"]*"><span id="capText"><\/span><\/div>/);
  assert.match(html, /"capMode":"karaoke"/);
  assert.match(html, /"captions":\[\{/, 'cues ride into the page');
  assert.match(html, /\.cap\{[^}]*font-family:'Anton'/, 'and the chosen font styles them');
});
