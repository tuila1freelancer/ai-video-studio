// P38 — reference-parity layout (hard px thresholds + per-ratio rules) and the per-scene
// backdrop rotation. Pure/fast: no browser, no ffmpeg.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewportBlock, ratioRulesBlock, ratioClass } from '../src/hyperframe/prompt.js';
import { BACKDROP_STYLES, ALL_MOTIFS, backdropForScene } from '../src/animation/backdrop.js';

test('P39 viewportBlock emits the reference INTEGER threshold table for the ratio', () => {
  const v = viewportBlock(1920, 1080, true); // 16:9 → the reference app's exact integers
  for (const [k, val] of [['SIDE_PADDING', 90], ['TOP_PADDING', 70], ['BOTTOM_PADDING', 90],
    ['TEXT_MAX_W', 980], ['HERO_MAX_W', 920], ['CARD_MIN_W', 520], ['CARD_MAX_W', 760],
    ['SUBJECT_MAX_H', 450], ['TEXT_BLOCK_MAX_H', 300], ['SAFE_CENTER_W', 1320], ['SAFE_CENTER_H', 620], ['SPLIT_GAP', 80]]) {
    assert.ok(v.includes(`${k}=${val}px`), `${k}=${val}px (reference 16:9 table)`);
  }
  assert.ok(v.includes(`LOWER_THIRD_Y=${Math.round(1080 * 0.807)}px`), 'lower-third at ~80.7% H');
  assert.match(v, /THE THRESHOLDS WIN/, 'ratio thresholds override a conflicting concept');
  assert.match(v, /USE THESE EXACT VALUES DIRECTLY/, 'model must use the values directly, not estimate');
  // 9:16 pulls a DIFFERENT integer table (SIDE 70 / BOTTOM 130 / SUBJECT_MAX_H 990)
  const v9 = viewportBlock(1080, 1920, true);
  assert.ok(v9.includes('SIDE_PADDING=70px') && v9.includes('BOTTOM_PADDING=130px') && v9.includes('SUBJECT_MAX_H=990px'), '9:16 uses its own table');
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
