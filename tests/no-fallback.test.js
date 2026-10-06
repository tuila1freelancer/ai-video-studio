// P25 — NO-FALLBACK codegen contract: the primary model gets up
// to 10 attempts, then the failure THROWS loudly; B5 never swaps in a fallback model or a
// heuristic template for hyperframe scenes, and strips modelFallback from the codegen ai.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSceneSpec } from '../src/hyperframe/codegen.js';
import { normalizeGuide } from '../src/styleguide/index.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('P25 no-fallback: generateSceneSpec exhausts exactly 10 primary-model attempts, then throws', async () => {
  const logs = [];
  // llm disabled → every attempt fails at the chat() gate — no network, counts attempts
  await assert.rejects(
    () => generateSceneSpec({
      scene: { voice_text: 'thử', visual_prompt: '', duration: 4, srt_json: [] },
      guide: normalizeGuide(null), w: 640, h: 360, idx: 0, total: 1,
      ai: { llm: { enabled: false } }, renderCheck: false,
      onLog: (m) => logs.push(m),
    }),
    /codegen thất bại sau 10 lần/,
  );
  assert.equal(logs.filter((m) => /LLM lỗi \(lần \d+\/10\)/.test(m)).length, 10, 'all 10 attempts hit the primary model');
});

test('P25 no-fallback: B5 has no rescue lane — failures collect, the stage throws, resume retries only them', () => {
  const b5 = src('src/pipeline/stages/visuals.js');
  assert.ok(!/modelFallback\s*:/.test(b5), 'no modelFallback is ever passed to codegen');
  assert.match(b5, /delete baseLlm\.modelFallback/, 'codegen ai strips modelFallback');
  assert.ok(!/planScene\(/.test(b5), 'no heuristic-template fallback for hyperframe scenes');
  assert.match(b5, /codegenFailures/, 'failures are collected');
  assert.match(b5, /không dùng fallback/, 'stage failure message states the contract');
  assert.match(b5, /status: 'error'/, 'failed scenes are marked error (props stay empty → resume regenerates them)');
});

test('P25 no-fallback: parity harness mirrors production (primary model only)', () => {
  const run = src('scripts/parity/run.mjs');
  assert.match(run, /delete ai\.llm\.modelFallback/);
});

test('P25 no-fallback: render heal never swaps a hyperframe scene to a template (P10 stays animation-only)', () => {
  const b6 = src('src/pipeline/stages/render.js');
  assert.match(b6, /sc\.template !== 'kinetic-statement' && sc\.template !== 'hyperframe'/, 'hyperframe scenes retry as-is');
});
