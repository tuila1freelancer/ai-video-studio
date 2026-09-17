// Text-overlap + contrast thresholds used by renderValidate's in-page probe — the pure
// mirrors are exported so the geometry/color math stays pinned without a browser.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { overlapFrac, contrastRatio } from '../src/hyperframe/validate.js';


test('overlapFrac: fraction of the SMALLER box; disjoint boxes are 0', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(overlapFrac(a, { x: 200, y: 0, w: 50, h: 50 }), 0, 'disjoint');
  assert.equal(overlapFrac(a, { x: 0, y: 0, w: 50, h: 50 }), 1, 'contained box fully overlapped');
  assert.equal(overlapFrac(a, { x: 50, y: 0, w: 100, h: 100 }), 0.5, 'half of equal-size neighbor');
  assert.ok(overlapFrac(a, { x: 90, y: 90, w: 100, h: 100 }) < 0.30, 'corner graze stays under the 0.30 gate');
});

test('contrastRatio: WCAG anchors (white/black 21:1, same color 1:1) and the 2.2 gate', () => {
  assert.ok(Math.abs(contrastRatio([255, 255, 255], [0, 0, 0]) - 21) < 0.1);
  assert.ok(Math.abs(contrastRatio([120, 120, 120], [120, 120, 120]) - 1) < 0.001);
  assert.ok(contrastRatio([242, 245, 255], [7, 7, 13]) > 4.5, 'guide ink-on-bg is comfortably readable');
  assert.ok(contrastRatio([60, 60, 70], [7, 7, 13]) < 2.2, 'dim gray on near-black trips the gate');
});

test('P39 codegen re-asks ONLY on the structural floor; geometry is advisory (no HARD_DEFECT lane)', () => {
  const s = sourceOf('src/hyperframe/codegen.js');
  // P39 (reference-parity): the hard/soft defect classifier and the lastGood graceful-fallback
  // lane are gone. A scene ships as soon as it passes lint + syntax + the structural render floor
  // (script didn't throw, scene isn't blank); every geometry finding is an advisory warning.
  assert.ok(!/HARD_DEFECT/.test(s), 'the HARD_DEFECT classifier is removed');
  assert.ok(!/lastGood/.test(s), 'the lastGood graceful-fallback lane is removed (no-fallback loud fail)');
  assert.match(s, /renderDefects = rv\.defects/, 'render defects come from the validate structural floor');
  assert.match(s, /renderWarnings = rv\.warnings/, 'geometry warnings are captured separately (logged, not re-asked)');
  assert.match(s, /const allIssues = \[\.\.\.errors, \.\.\.renderDefects\]/, 're-ask set = lint/syntax errors + structural defects only');
});

test('persistence tiering: one-sample transients are dropped, held findings survive', async () => {
  const { heldAcrossSamples } = await import('../src/hyperframe/validate.js');
  assert.equal(heldAcrossSamples({ n: 1 }), false, 'entrance/exit transient ignored');
  assert.equal(heldAcrossSamples({ n: 2 }), true, 'held across two samples is real');
  assert.equal(heldAcrossSamples(undefined), false, 'missing entry is not a defect');
});
