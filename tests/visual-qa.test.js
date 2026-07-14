// Text-overlap + contrast thresholds used by renderValidate's in-page probe — the pure
// mirrors are exported so the geometry/color math stays pinned without a browser.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlapFrac, contrastRatio } from '../src/hyperframe/validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

test('overlap + unreadable defects are HARD (trigger codegen re-ask, not just lastGood)', () => {
  const s = readFileSync(join(ROOT, 'src/hyperframe/codegen.js'), 'utf8');
  const re = s.match(/HARD_DEFECT = (\/.*\/i)/)?.[1];
  assert.ok(re, 'HARD_DEFECT regex present');
  const rx = new RegExp(re.slice(1, -2), 'i');
  assert.ok(rx.test('the texts "A" and "B" overlap each other at 1.0s'), 'overlap phrase is hard');
  assert.ok(rx.test('the text "X" is unreadable at 2.0s'), 'contrast phrase is hard');
  assert.ok(rx.test('the frame goes empty at 4.4s mid-scene'), 'mid-scene deadness phrase is hard');
  assert.ok(rx.test('element runs 40px off-screen'), 'existing phrases intact (P-guard parity)');
});
