// P38 — reference-parity layout (hard px thresholds + per-ratio rules) and the per-scene
// backdrop rotation. Pure/fast: no browser, no ffmpeg.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewportBlock, ratioRulesBlock, ratioClass } from '../src/hyperframe/prompt.js';
import { BACKDROP_STYLES, ALL_MOTIFS, backdropForScene } from '../src/animation/backdrop.js';

test('P38 viewportBlock emits the full hard-threshold set and mandates using it', () => {
  const v = viewportBlock(1920, 1080, true);
  for (const k of ['SIDE_PADDING', 'TOP_PADDING', 'BOTTOM_PADDING', 'SAFE_CENTER', 'SPLIT_GAP',
    'TEXT_MAX_W', 'TEXT_BLOCK_MAX_H', 'HERO_MAX_W', 'SUBJECT_MAX_H', 'CARD_MIN_W', 'CARD_MAX_W', 'LOWER_THIRD_Y']) {
    assert.ok(v.includes(k), `${k} threshold present`);
  }
  assert.match(v, /THE THRESHOLDS WIN/, 'ratio thresholds override a conflicting concept');
  assert.match(v, /USE THESE VALUES DIRECTLY/, 'model must use the values directly, not estimate');
  assert.ok(v.includes(`LOWER_THIRD_Y=${Math.round(1080 * 0.807)}px`), 'lower-third at ~80.7% H');
  // captions off → no subtitle band, full height usable
  assert.match(viewportBlock(1920, 1080, false), /Subtitles are OFF/);
});

test('P38 ratioClass + ratioRulesBlock select the right per-ratio rules', () => {
  assert.equal(ratioClass(1920, 1080), '16:9');
  assert.equal(ratioClass(1080, 1920), '9:16');
  assert.equal(ratioClass(1080, 1080), '1:1');
  assert.equal(ratioClass(1080, 1350), '4:5');
  assert.match(ratioRulesBlock(1920, 1080), /SPREAD HORIZONTALLY/, '16:9 spreads wide, never center-clumps');
  assert.match(ratioRulesBlock(1080, 1920), /reading order/, '9:16 stacks vertically');
  assert.match(ratioRulesBlock(1080, 1080), /SYMMETRY/, '1:1 is symmetric');
  assert.match(ratioRulesBlock(1080, 1350), /ABOVE center/, '4:5 is top-heavy');
});

test('P38 buildCodegenPrompt wires the viewport + ratio-rule blocks; composition uses a 3x3 grid', () => {
  const s = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(s, /\$\{viewportBlock\(w, h, captionsOn\)\}\n\$\{ratioRulesBlock\(w, h\)\}/, 'both layout blocks are injected, in order');
  assert.match(s, /3×3 grid/, 'the composition rule distributes weight across a 3x3 grid');
});

test('P38 backdrop rotation is deterministic, non-repeating, and stays a legal guide motif', () => {
  assert.ok(BACKDROP_STYLES.length >= 8, 'a rich rotation pool');
  assert.equal(backdropForScene({}, 3, 42), backdropForScene({}, 3, 42), 'deterministic for the same input');
  assert.notEqual(backdropForScene({}, 3, 42), backdropForScene({}, 4, 42), 'consecutive scenes differ');
  assert.notEqual(backdropForScene({}, 0, 0), backdropForScene({}, 0, 3), 'the per-video salt shifts the start');
  assert.equal(backdropForScene({ visual_prompt: '[ROLE] cta' }, 5, 7), 'spotlight', 'a calm cta gets a quiet spotlight');
  const guideSrc = readFileSync(new URL('../src/styleguide/guide.js', import.meta.url), 'utf8');
  for (const s of ALL_MOTIFS) assert.ok(guideSrc.includes(`'${s}'`), `${s} is whitelisted as a legal guide motif`);
});
