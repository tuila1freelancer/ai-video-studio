// P41 — EVEN LAYOUT. Owner order 2026-08-02: "bố cục và nội dung đều nhau, không cần quan tâm
// đến phụ đề ghi đè". Pins the three things that make evenness real rather than aspirational:
// the few-shot example demonstrates it, nothing reserves a band that squeezes the composition,
// and the validator measures zones by PRESENCE (a corner kicker is not a hole).
// Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLE_SPEC } from '../src/styleguide/index.js';
import { viewportBlock, overlayBlock } from '../src/hyperframe/prompt.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Which of the 9 zones each slot's anchor point falls in. */
function slotZones(html) {
  const slots = [...html.matchAll(/left:(\d+)%;top:(\d+)%/g)].map((m) => [+m[1], +m[2]]);
  const grid = new Array(9).fill(0);
  for (const [x, y] of slots) grid[(y < 33 ? 0 : y < 67 ? 1 : 2) * 3 + (x < 33 ? 0 : x < 67 ? 1 : 2)]++;
  return { slots, grid, filled: grid.filter((v) => v > 0).length };
}

test('P41: the few-shot example spreads its anchors instead of teaching a centre-stack', () => {
  const { slots, filled } = slotZones(SAMPLE_SPEC.html);
  assert.ok(slots.length >= 6, `the example needs enough anchors to demonstrate spread, got ${slots.length}`);
  // it used to put six anchors in three zones and leave 6/9 cells empty — the exact imbalance
  // measured in real renders (starved top corners, 1.7x dead-centre)
  assert.ok(filled >= 5, `the example must occupy ≥5 of the 9 zones, occupies ${filled}`);
  const xs = slots.map(([x]) => x), ys = slots.map(([, y]) => y);
  assert.ok(Math.min(...xs) <= 25, 'something is anchored on the far left');
  assert.ok(Math.max(...xs) >= 75, 'something is anchored on the far right');
  assert.ok(Math.min(...ys) <= 20, 'something is anchored near the top');
  assert.ok(Math.max(...ys) >= 80, 'something is anchored near the bottom');
  // the bottom-centre anchor is a thin tick scale — structure, not a competing headline
  assert.match(SAMPLE_SPEC.css, /\.hf-scale\{/, 'the bottom anchor is styled');
  assert.match(SAMPLE_SPEC.script, /#sc1/, 'and animated, so it is a live part of the composition');
});

test('P41: no subtitle rule may evict a third of the frame', () => {
  const on = viewportBlock(1920, 1080, true);
  assert.match(on, /LOWER_THIRD_Y=\d+px/, 'the band is still described');
  assert.ok(!/keep all foreground content above it/.test(on), 'but it no longer evicts everything');
  assert.match(on, /do NOT leave the bottom of the frame empty/i, 'the bottom must still be used');
  // edit-video reserves nothing at all
  assert.ok(!/KEEP THE BOTTOM/.test(overlayBlock({ edit: true })), 'edit mode reserves no band');
  assert.match(src('../src/hyperframe/prompt.js'), /an empty bottom strip is a worse mistake than a busy one/);
});

test('P41: the validator measures zones by PRESENCE, and stays advisory', () => {
  const v = src('../src/hyperframe/validate.js');
  assert.match(v, /const zones=\[0,0,0,0,0,0,0,0,0\], zoneEls=/, 'ink share AND an anchor count per zone');
  assert.match(v, /zones:zones\.map\(z=>\+\(z\/zTotal\)\.toFixed\(3\)\),zoneEls/, 'both reach the caller');
  // a zone is dead only when it has NO anchor and almost no ink — ink alone flags good frames
  assert.match(v, /z < 0\.03 && !\(bestZoneEls && bestZoneEls\[i\]\)/);
  assert.match(v, /dead\.length >= 3/, 'a couple of quiet zones is composition, not a defect');
  // judged on the best-filled sample: the beat protocol starts the scene nearly bare on purpose
  assert.match(v, /if \(score < bestZoneScore\)/);
  // and it can only ever warn — P39's advisory contract still holds
  const block = v.slice(v.indexOf('if (bestZones)'), v.indexOf('if (bestZones)') + 1600);
  assert.ok(!/defects\.push/.test(block), 'evenness never blocks a render');
  assert.ok(/warnings\.push/.test(block));
});
