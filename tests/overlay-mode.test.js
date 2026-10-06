// P24 — overlay mode: scenes render on the solid key color with every stage dressing
// stripped (particles/grid/vignette/grain/watermark/progress), captions kept; the
// hyperframe template drops motif/deco; lint bans backdrop-filter; the composite helper
// exists with the standard colorkey defaults. Off by default: pages are byte-identical
// to the pre-overlay ones when config.overlay is absent.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenePage } from '../src/animation/harness.js';
import { buildTemplate, makeCtx } from '../src/animation/templates.js';
import { getTheme } from '../src/animation/themes.js';
import { lintSpec } from '../src/hyperframe/lint.js';
import { overlayBlock } from '../src/hyperframe/prompt.js';

const theme = getTheme('neon-tech');
const base = {
  w: 960, h: 540, theme, seed: 1, duration: 5, progressStart: 0, progressTotal: 5,
  template: { css: '', html: '<div class="hf-center"><div class="hf-kw">X</div></div>', script: '' },
  captions: [{ start: 0, end: 1, text: 'xin chào', words: [{ word: 'xin', start: 0, end: 0.5 }] }],
  watermark: { text: 'kênh' }, captionStyle: {},
};

test('P24 overlay: the page renders on the solid key color with no stage dressing, captions kept', () => {
  const html = buildScenePage({ ...base, overlay: { key: '#050510' } });
  assert.match(html, /html,body\{[^}]*background:#050510\}/, 'body sits on the key color');
  assert.ok(!/<canvas id="bgCanvas"/.test(html), 'no particle canvas element');
  assert.ok(!/<div class="vig">/.test(html) && !/<div class="grid">/.test(html), 'no vignette/grid layers');
  assert.ok(!/<div class="progtrack">/.test(html), 'no progress bar element');
  assert.ok(!/<div class="wm wmt">/.test(html), 'no watermark element');
  assert.ok(html.includes('capText'), 'captions stay for compositing over footage');
});

test('P24 overlay: default page is unchanged when overlay is off', () => {
  const html = buildScenePage(base);
  assert.ok(html.includes('bgCanvas') && html.includes('progtrack') && html.includes('wmt'));
  assert.match(html, /radial-gradient\(ellipse at 50% 30%/); // P39: cinematic stage gradient
});

test('P24 overlay: hyperframe template drops motif/deco/vig/grain and beat pulses under props.overlay', () => {
  const ctx = makeCtx({ w: 960, h: 540, theme, seed: 1, duration: 5, idx: 0 });
  const on = buildTemplate('hyperframe', { html: '<div class="hf-kw">A</div>', script: 'tl.to(".hf-kw",{opacity:1,duration:1},0);', overlay: true, beats: [{ t0: 1 }] }, ctx);
  assert.ok(!on.html.includes('hf-far') && !on.html.includes('hf-vig') && !on.html.includes('hf-grain'));
  assert.match(on.script, /__hfBeats=\[\]/, 'no beat pulse targets a missing deco layer');
  const off = buildTemplate('hyperframe', { html: '<div class="hf-kw">A</div>', script: '', beats: [{ t0: 1 }] }, ctx);
  assert.ok(off.html.includes('hf-far') && off.html.includes('hf-vig'));
});

test('P24 overlay: lint bans backdrop-filter only in overlay mode; the prompt block teaches the key rules', () => {
  const spec = { css: '.p{backdrop-filter:blur(9px)}', html: '<div class="p">x</div>', script: 'tl.to(".p",{opacity:1,duration:1},0);' };
  assert.ok(lintSpec(spec, { overlay: true }).errors.some((e) => /backdrop-filter/.test(e)));
  assert.ok(!lintSpec(spec).errors.some((e) => /backdrop-filter/.test(e)));
  const block = overlayBlock();
  assert.ok(/40-50%/.test(block) && /3-layer shadow/.test(block) && /colorkey|keyed transparent/i.test(block));
});

test('P24 overlay: compositeColorkey is exported with its standard defaults', async () => {
  const { compositeColorkey } = await import('../src/media/ffmpeg.js');
  assert.equal(typeof compositeColorkey, 'function');
});
