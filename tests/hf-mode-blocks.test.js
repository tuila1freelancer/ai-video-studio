// P22 — mode blocks on the codegen lane:
//   consistent-scenes: prompt block locks bg + primary accent for every scene
//   image-full: master-assigned scene assets ride rows → prompt block + {{asset:NAME}}
//   substitution AFTER lint; unresolved placeholders can never reach the page.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { consistentScenesBlock, imageFullBlock, applyAssetMedia } from '../src/hyperframe/codegen.js';
import { buildCodegenPrompt } from '../src/hyperframe/prompt.js';
import { normalizeGuide } from '../src/styleguide/index.js';

const guide = normalizeGuide(null);

test('P22 mode-blocks: consistent-scenes block carries the exact locked colors into the prompt', () => {
  const block = consistentScenesBlock(guide);
  assert.ok(block.includes(guide.palette.bg));
  assert.ok(block.includes(guide.palette.accents[0]));
  const msgs = buildCodegenPrompt({
    scene: { voice_text: 'x', visual_prompt: '' }, beats: [], direction: { isClimax: false },
    guide, w: 1920, h: 1080, duration: 6, idx: 0, total: 3, modeBlocks: [block],
  });
  assert.ok(msgs[1].content.includes('CONSISTENT SCENES MODE'));
});

test('P22 mode-blocks: image-full block names the asset and teaches the {{asset:NAME}} placeholder', () => {
  const block = imageFullBlock(['chart-q3.png']);
  assert.ok(block.includes('{{asset:chart-q3.png}}'));
  assert.ok(/75%/.test(block), 'hero coverage mandate');
  assert.ok(/Ken Burns/i.test(block));
});

test('P22 mode-blocks: applyAssetMedia substitutes resolved names and strips unresolved media', () => {
  const spec = {
    html: '<img class="hf-media" src="{{asset:chart-q3.png}}"><img src="{{asset:ghost.png}}"><span>{{asset:ghost.png}}</span>',
  };
  applyAssetMedia(spec, [{ name: 'chart-q3.png', uri: 'data:image/jpeg;base64,AAA' }]);
  assert.ok(spec.html.includes('src="data:image/jpeg;base64,AAA"'), 'resolved placeholder inlined');
  assert.ok(!spec.html.includes('{{asset:'), 'no placeholder survives');
  assert.ok(!/ghost\.png/.test(spec.html), 'unresolved img removed entirely');
  assert.ok(spec.html.includes('<span></span>'), 'non-img placeholder stripped in place');
});
