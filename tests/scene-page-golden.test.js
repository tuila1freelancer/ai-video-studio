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
// The whole font prologue is stripped before hashing — everything from `<style>` up to the first
// real rule. Font DELIVERY is deliberately free to change (the vendored css is being cut down
// from all-families-always to only-what-this-scene-uses, which takes ~500KB off every page);
// what must not change is the markup, the caption CSS, and the scene data payload. Hashes were
// re-captured with this stripper against the unmodified builder, so the numbers still describe
// the same pre-change page.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSceneHtml } from '../src/animation/index.js';
import { renderFingerprint } from '../src/pipeline/fingerprint.js';

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

const strip = (html) => html.replace(/<style>[\s\S]*?(?=\*\{margin:0)/, '<style>\n');
const hash = (html) => createHash('sha256').update(strip(html)).digest('hex').slice(0, 32);
const page = (config) => buildSceneHtml(scene, project, config, { total: 3 });

// Re-frozen 2026-08-18 for `__fitVietnamese`. The page moved DELIBERATELY: the runtime gained a
// typesetting repair that gives Vietnamese stacked marks the room the line box denies them.
//
// The header above says a page shift means "every clip stops matching its own render fingerprint".
// That was never true — `renderFingerprint` hashes scene props and config KEYS, not the page — and
// the distinction matters here: nothing re-renders on its own, so an existing video keeps its
// broken clips until something asks for them again. That is what the repair action is for. The
// pass is deliberately NOT behind a config key: it is a correctness repair, and a flag would mean
// every project that predates it renders Vietnamese wrong until somebody remembers to tick a box.
const GOLDEN = {
  plain: 'b85cde27bcb8152803fed7df8b3f9c4d',
  styled: 'b29fbdb953ec4f942239b8138d475d35',
  off: 'c9c12bc6d43d4d4d2fedb44d16f80973',
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

test('subtitleLane:"scene" is the default spelled out — it changes nothing', () => {
  // Same trap as the fingerprint: saving the default explicitly must render an identical page,
  // or switching the setting on and straight back off would re-render the whole video.
  assert.equal(hash(page({ enableSubtitles: true, subtitleLane: 'scene' })), GOLDEN.plain);
  assert.equal(hash(page({ ...STYLED, subtitleLane: 'scene' })), GOLDEN.styled);
  assert.equal(hash(page({ enableSubtitles: false, subtitleLane: 'scene' })), GOLDEN.off);
});

test('subtitleLane:"final" renders the clip bare but still reserves the caption band', () => {
  const html = page({ ...STYLED, subtitleLane: 'final' });
  assert.ok(!/id="capText"/.test(html), 'no caption element — the burn happens at concat');
  // The cues DO ride along, as layout data. `__safeZone` lifts any hero slot that intrudes into
  // the bottom band, and it decides from `S.captions.length`; with an empty array a final-lane
  // clip reserved no room at all, so the captions burned on later would land on top of the
  // content. A clip that has to be re-rendered to receive subtitles defeats the whole lane.
  assert.match(html, /"captions":\[\{/, 'the cue payload is the layout reserve');
  assert.match(html, /if \(!\(S\.captions && S\.captions\.length\)\) return;/, 'and this is what reads it');
});

test('the caption band is reserved on the final lane even with subtitles off', () => {
  // Turning captions on and off must stay a CONCAT-level decision — it cannot be one if it
  // changes the picture underneath, because then every toggle would re-render every scene.
  const on = page({ ...STYLED, subtitleLane: 'final' });
  const off = page({ ...STYLED, subtitleLane: 'final', enableSubtitles: false });
  assert.equal(hash(on), hash(off), 'the clip is identical either way');
  // …and the scene lane keeps its old behaviour: no captions, no reserve.
  assert.match(page({ ...STYLED, enableSubtitles: false }), /"captions":\[\]/);
});

test('the lane must not disturb anything outside the caption layer', () => {
  // Template markup, background canvas, progress bar, brand layer and the GSAP payload all have
  // to survive the switch untouched — otherwise "turn on the fast subtitle lane" would quietly
  // restyle the video as well.
  const strip2 = (html) => html
    .replace(/<div class="cap[^"]*"><span id="capText"><\/span><\/div>/, '')
    // the cue payload nests a `words` array, so a naive [^\]]* stops at the wrong bracket
    .replace(/"captions":\[[\s\S]*?\](?=,"capMode")/, '"captions":[]')
    .replace(/<style>[\s\S]*?(?=\*\{margin:0)/, '<style>\n');
  assert.equal(
    createHash('sha256').update(strip2(page(STYLED))).digest('hex'),
    createHash('sha256').update(strip2(page({ ...STYLED, subtitleLane: 'final' }))).digest('hex'),
  );
});

test('word timings still drive template motion on the final lane', () => {
  // ctx.captions feeds accentTimes — template beats are choreographed onto the narration's
  // words. Zeroing it along with the DISPLAY cues would change the animation itself, which is
  // not what "move the subtitles to the end" is supposed to mean.
  const tpl = (html) => /<div class="tpl">[\s\S]*?<\/div>\n/.exec(html)?.[0] || '';
  assert.ok(tpl(page(STYLED)).length > 40, 'the template block is there to compare');
  assert.equal(tpl(page(STYLED)), tpl(page({ ...STYLED, subtitleLane: 'final' })));
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

test('the scene hand-off is opt-in, and opting in invalidates the clips it changes', () => {
  // The ramp lets the concat blend an emptied frame against an arriving one instead of
  // superimposing two full ones — but it is baked into the clip, so it must not appear on a
  // project that did not ask, and asking must re-render.
  assert.doesNotMatch(page({}), /__scene[^<]*handoff/, 'absent by default');
  assert.match(page({ hyperframeHandoff: true }), /handoff.*?0\.38/, 'present when asked for');

  // The key name is load-bearing. renderFingerprint hashes CONFIG keys matched by
  // RENDER_CFG_KEYS (/^(sub|brandKit|hyperframe|…)/), never the harness source — so a name that
  // did not start with `hyperframe` would leave a video silently mixing ramped and un-ramped
  // clips, with nothing to detect it.
  const sc = { id: 's1', idx: 0, duration: 6, template: 'kinetic-statement', props: {} };
  const proj = { project: { aspect_ratio: '16:9' } };
  assert.notEqual(
    renderFingerprint(sc, { ...proj, config: { hyperframeHandoff: true } }),
    renderFingerprint(sc, { ...proj, config: {} }),
    'turning the ramp on must make existing clips stale',
  );
});
