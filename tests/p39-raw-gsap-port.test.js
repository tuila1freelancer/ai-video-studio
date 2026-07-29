// P39 — raw-GSAP reference port. Pins the four pillars that make the output match the reference
// app: (1) strong codegen model + token headroom, (2) raw-GSAP lint contract, (3) exact integer
// threshold tables, (4) reference-grade encode. Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveProjectConfig } from '../src/core/config.js';
import { viewportBlock } from '../src/hyperframe/prompt.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('P39 pillar 3: new projects default codegen to the strong proxy model', () => {
  const cfg = resolveProjectConfig({});
  assert.equal(cfg.hyperframe.model, 'ag/gemini-pro-agent', 'strong stable proxy model is the codegen default');
  // still just a per-project override — a channel/preset/request value wins
  const over = resolveProjectConfig({ request: { hyperframe: { model: 'custom/x' } } });
  assert.equal(over.hyperframe.model, 'custom/x', 'an explicit request model overrides the default');
});

test('P39 pillar 3: codegen sends generous token headroom for full-page specs', () => {
  const s = src('../src/hyperframe/codegen.js');
  assert.match(s, /maxTokens:\s*24000/, 'codegen requests 24k tokens (was 6500)');
});

test('P39 pillar 4: per-scene + master + colorkey encodes are reference-grade (crf 18)', () => {
  assert.match(src('../src/animation/renderer.js'), /'-crf', '18'.*'-profile:v', 'high'/s, 'per-scene encode crf18 High');
  assert.match(src('../src/pipeline/render.js'), /'-crf', '18'.*'-profile:v', 'high'/s, 'final master encode crf18 High');
  assert.match(src('../src/media/ffmpeg.js'), /'-crf', '18'/, 'overlay colorkey encode crf18');
});

test('P39 pillar 2: the prompt teaches raw GSAP, not an FX-only ban', () => {
  const p = src('../src/hyperframe/prompt.js');
  assert.ok(!/NEVER call gsap\.\* directly/.test(p), 'the blanket "never gsap.*" ban is gone');
  assert.match(p, /RAW GSAP TIMELINE/, 'the model is told to author a raw GSAP timeline');
  assert.match(p, /gsap\.set\(\) for instant/, 'gsap.set is explicitly allowed');
  assert.match(p, /≥5 elements animating/, 'rich-animation doctrine (≥5 moving elements)');
});

test('P39 pillar 3: threshold tables are byte-exact per ratio, and scale a non-standard canvas', () => {
  // 4:5 reference integers (1080x1350)
  const v45 = viewportBlock(1080, 1350, true);
  assert.ok(v45.includes('SIDE_PADDING=65px') && v45.includes('BOTTOM_PADDING=105px') && v45.includes('CARD_MAX_W=820px'), '4:5 table');
  // 1:1 reference integers (1080x1080)
  const v11 = viewportBlock(1080, 1080, true);
  assert.ok(v11.includes('SIDE_PADDING=70px') && v11.includes('SAFE_CENTER_W=740px'), '1:1 table');
  // a half-size 16:9 canvas scales the 90px side padding to ~45px (proportional, still correct)
  assert.match(viewportBlock(960, 540, true), /SIDE_PADDING=45px/, 'non-standard canvas scales proportionally');
});
