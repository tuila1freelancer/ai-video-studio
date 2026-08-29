// The two report checks that fired on a clean 101-scene video: an empty-tag sweep that hit every
// decorative box, and a text sweep that read CSS tails as a foreign language.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankedLabel } from '../src/api/services/qc-scan.js';

test('blankedLabel ignores decorative boxes that never hold text', () => {
  assert.equal(blankedLabel('<div class="hf-orb o1"></div>'), false);
  assert.equal(blankedLabel('<div class="v-grid"></div>'), false);
  assert.equal(blankedLabel('<div class="c-fill" id="lc-fill" style="background:#000"></div>'), false);
  assert.equal(blankedLabel('<div class="spark-core" id="lc-spark"></div>'), false);
});

test('blankedLabel still catches a text slot the sanitiser blanked', () => {
  assert.equal(blankedLabel('<div class="hf-label" id="kicker"></div>'), true);
  assert.equal(blankedLabel('<span class="lbl"></span>'), true);
  assert.equal(blankedLabel('<div class="hc-title hf-kw"></div>'), true);
  assert.equal(blankedLabel('<span class="r-tag"></span>'), true);
});

test('blankedLabel tolerates missing or non-string html', () => {
  assert.equal(blankedLabel(null), false);
  assert.equal(blankedLabel(undefined), false);
  assert.equal(blankedLabel(''), false);
});
