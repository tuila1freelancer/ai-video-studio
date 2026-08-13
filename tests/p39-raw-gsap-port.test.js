// P39 — raw-GSAP reference port. Pins the four pillars that make the output match the reference
// app: (1) strong codegen model + token headroom, (2) raw-GSAP lint contract, (3) exact integer
// threshold tables, (4) reference-grade encode. Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveProjectConfig } from '../src/core/config.js';
import * as DB from '../src/db/index.js';
import { viewportBlock } from '../src/hyperframe/prompt.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ai-providers amends this pillar (owner's call 2026-08-13). The pin used to be the constant
// `ag/gemini-pro-agent`, which exists only on the owner's own proxy — fine while that was the
// only endpoint anyone used, a guaranteed render failure the moment the provider picker let
// someone choose Groq. The requirement it encoded is unchanged: codegen must run on a strong
// GEMINI model, because nothing else writes scene markup that renders. It is now resolved from
// the configured provider instead of hardcoded, and an unrecognised endpoint still gets the
// original value, so the owner's own install is untouched.
test('P39 pillar 3: a new project pins the codegen model its provider actually serves', () => {
  const settings = (llm) => DB.setSetting('ai', { ...DB.aiSettings(), llm });

  settings({ preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k', model: 'gemini-2.5-flash-lite' });
  assert.match(resolveProjectConfig({}).hyperframe.model, /gemini/i, 'Gemini serves a strong Gemini model');

  // an endpoint the catalogue does not know: keep the model this app has always pinned
  settings({ preset: 'custom', baseUrl: 'http://127.0.0.1:20128/v1', apiKey: 'k', model: 'ag/x' });
  assert.equal(resolveProjectConfig({}).hyperframe.model, 'ag/gemini-pro-agent');

  // a provider with no Gemini at all states no opinion, and codegen falls back to the general
  // model rather than demanding one the provider would 404 on
  settings({ preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'llama-3.1-8b-instant' });
  assert.equal(resolveProjectConfig({}).hyperframe.model, '');

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
