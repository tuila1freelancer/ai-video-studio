// The cost meter writes est_cost into the usage table permanently, so a matcher that misses
// is not a cosmetic bug — it is a wrong number the user can never recover. pricing.js is pure
// and had no test at all; these are functional, no DB and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, priceFor, PRICING_VERSION } from '../src/core/pricing.js';

const MTOK = 1_000_000;
const llm = (model, provider = null) => estimateCost({ kind: 'llm', model, provider, promptTokens: MTOK, completionTokens: 0 });

test('bare model ids keep pricing exactly as they always did', () => {
  assert.deepEqual(priceFor('gpt-4o-mini'), [0.15, 0.60]);
  assert.deepEqual(priceFor('claude-opus-5'), [15.00, 75.00]);
  assert.equal(estimateCost({ kind: 'llm', model: 'gpt-4o-mini', promptTokens: MTOK, completionTokens: MTOK }), 0.75);
});

test('a namespaced id prices like its family instead of falling to the default rate', () => {
  // Every one of these billed at LLM_DEFAULT [0.50, 2.00] before — 4x over on gemini-flash.
  for (const [id, expected] of [
    ['openai/gpt-4o-mini', [0.15, 0.60]],
    ['google/gemini-2.5-flash', [0.30, 2.50]],
    ['deepseek-ai/DeepSeek-V4-Flash', [0.14, 0.28]],
    ['accounts/fireworks/models/llama-3.3-70b-instruct', [0.59, 0.79]],
    ['models/gemini-2.5-pro', [1.25, 10.00]],
    ['ag/gemini-pro-agent', [0.30, 2.50]],
  ]) {
    assert.deepEqual(priceFor(id), expected, id);
    assert.notDeepEqual(priceFor(id), [0.50, 2.00], `${id} must not bill at the default rate`);
  }
});

test('OpenRouter :free variants cost nothing, with or without a namespace', () => {
  assert.deepEqual(priceFor('qwen/qwen3-32b:free'), [0, 0]);
  assert.deepEqual(priceFor('deepseek-v4-flash:free'), [0, 0]);
  assert.equal(llm('google/gemini-2.5-flash:free'), 0);
  // a :nitro variant is a routing preference, NOT a discount — it still costs money
  assert.ok(llm('google/gemini-2.5-flash:nitro') > 0);
});

test('longest prefix still wins, namespaced or not', () => {
  assert.notDeepEqual(priceFor('gpt-4o'), priceFor('gpt-4o-mini'));
  assert.deepEqual(priceFor('openai/gpt-4o'), [2.50, 10.00]);
  assert.deepEqual(priceFor('gemini-2.5-flash-lite'), [0.10, 0.40]);
  assert.deepEqual(priceFor('google/gemini-2.5-flash-lite'), [0.10, 0.40]);
});

test('a genuinely unknown model keeps the conservative fallback, never $0', () => {
  assert.equal(priceFor('some-model-nobody-has-heard-of'), null);
  assert.equal(llm('some-model-nobody-has-heard-of'), 0.50);
  assert.equal(llm('acme/private-proxy-model'), 0.50);
});

test('a local model bills nothing; a free TIER still bills its paid rate', () => {
  assert.equal(llm('llama-3.3-70b', 'ollama'), 0);
  assert.equal(llm('qwen3-8b', 'lmstudio'), 0);
  // Groq's free tier is a quota, not a price — pretending it is free would understate the
  // moment the user crosses it.
  assert.ok(llm('llama-3.1-8b-instant', 'groq') > 0);
});

test('a provider may override a family rate for a model it runs more expensively', () => {
  assert.deepEqual(priceFor('gpt-oss-120b'), [0.15, 0.60]);
  assert.deepEqual(priceFor('gpt-oss-120b', 'cerebras'), [0.35, 0.75]);
  // an unknown provider falls back to the shared table rather than to the default rate
  assert.deepEqual(priceFor('gpt-oss-120b', 'some-new-host'), [0.15, 0.60]);
});

test('TTS pricing and the unknown-kind guard are unchanged', () => {
  assert.equal(estimateCost({ kind: 'tts', provider: 'elevenlabs', chars: 1000 }), 0.24);
  assert.equal(estimateCost({ kind: 'tts', provider: 'edge', chars: 10_000 }), 0);
  assert.equal(estimateCost({ kind: 'image', model: 'x' }), 0);
});

test('the version is stamped so a stored est_cost stays interpretable', () => {
  assert.match(PRICING_VERSION, /^\d{4}-\d{2}$/);
});
