// P45: the provider catalogue. A data file's realistic failure mode is a bad paste — a typo'd
// base URL, a duplicated id, a model list that lost its provider — so these assert the shape
// as hard as the behaviour. Pure: no database, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LLM_PRESETS, presetById, inferPreset, withPreset, codegenModelFor, presetsForLane, publicCatalog,
} from '../src/providers/llm-presets.js';

const TIERS = new Set(['free', 'cheap', 'premium', 'local', 'custom']);

test('every preset is well formed', () => {
  assert.ok(LLM_PRESETS.length >= 15, 'the catalogue should be worth having a picker for');
  const ids = new Set();
  for (const p of LLM_PRESETS) {
    assert.ok(p.id && !ids.has(p.id), `duplicate or missing id: ${p.id}`);
    ids.add(p.id);
    assert.ok(p.label, `${p.id} needs a label`);
    assert.ok(TIERS.has(p.tier), `${p.id} has an unknown tier: ${p.tier}`);
    assert.ok(p.note, `${p.id} needs a one-line note — the picker shows it`);
    assert.ok('codegenModel' in p, `${p.id} must state its codegen model, even as null`);
    assert.ok(p.lanes && typeof p.lanes === 'object', `${p.id} needs lanes`);
    const modelIds = (p.models || []).map((m) => m.id);
    assert.equal(new Set(modelIds).size, modelIds.length, `${p.id} lists a model twice`);
    for (const m of p.models || []) assert.ok(m.id && m.label, `${p.id} has a model missing id/label`);
  }
  assert.ok(ids.has('custom'), 'there must always be an escape hatch');
});

test('base URLs are https, except the ones that are on this machine', () => {
  for (const p of LLM_PRESETS) {
    if (!p.baseUrl) { assert.equal(p.id, 'custom'); continue; }
    const expected = p.tier === 'local' ? 'http:' : 'https:';
    assert.equal(new URL(p.baseUrl).protocol, expected, `${p.id}: ${p.baseUrl}`);
    assert.ok(!p.baseUrl.endsWith('/'), `${p.id} must not carry a trailing slash`);
    assert.ok(!/\/chat\/completions$/.test(p.baseUrl), `${p.id} must be a root, not an endpoint`);
  }
});

test('no preset ships a modelFallback', () => {
  // P25: a silent model swap looks like success while quietly degrading quality. A fallback
  // baked into the catalogue would re-introduce that on every non-codegen path.
  for (const p of LLM_PRESETS) {
    assert.equal(p.modelFallback, undefined, `${p.id} must not ship a fallback model`);
    assert.equal(p.compat?.modelFallback, undefined, `${p.id} must not ship a fallback model`);
  }
});

test('only a provider that actually serves Gemini may pin the codegen model', () => {
  // Owner's call 2026-08-13: HyperFrame renders correctly only on Gemini, and codegen has no
  // fallback — a non-Gemini pin is a loud render failure, not a soft downgrade.
  for (const p of LLM_PRESETS) {
    if (!p.codegenModel) continue;
    assert.match(p.codegenModel, /gemini/i, `${p.id} pins a codegen model that is not Gemini`);
  }
  assert.match(codegenModelFor({ preset: 'gemini' }), /^gemini-/);
  assert.match(codegenModelFor({ preset: 'openrouter' }), /^google\/gemini-/);
  assert.equal(codegenModelFor({ preset: 'groq' }), '', 'Groq has no Gemini — no opinion');
  // an unrecognised endpoint keeps exactly the model this app has always used
  assert.equal(codegenModelFor({ baseUrl: 'https://my-proxy.example/v1' }), 'ag/gemini-pro-agent');
  // an explicit per-install override beats the preset
  assert.equal(codegenModelFor({ preset: 'gemini', codegenModel: 'gemini-3.6-flash' }), 'gemini-3.6-flash');
});

test('a preset base URL round-trips back to its own id', () => {
  for (const p of LLM_PRESETS) {
    if (!p.baseUrl) continue;
    assert.equal(inferPreset(p.baseUrl), p.id, p.id);
    assert.equal(inferPreset(`${p.baseUrl}/`), p.id, `${p.id} + trailing slash`);
    assert.equal(inferPreset(`${p.baseUrl}/chat/completions`), p.id, `${p.id} + full endpoint`);
    assert.equal(inferPreset(p.baseUrl.toUpperCase()), p.id, `${p.id} uppercased`);
  }
});

test('anything unrecognised is custom, and custom carries no quirks', () => {
  for (const url of ['https://my-private-proxy.example/v1', 'http://fake.local', 'http://127.0.0.1:1/v1/chat/completions', '', null, 'not a url']) {
    assert.equal(inferPreset(url), 'custom', String(url));
  }
  const out = withPreset({ baseUrl: 'http://fake.local', apiKey: 'k', model: 'fake-m' });
  assert.equal(out.maxTokensParam, undefined);
  assert.equal(out.omitTemperature, undefined);
  assert.equal(out.extraHeaders, undefined);
  assert.equal(out.jsonMode, undefined);
  assert.equal(out.maxTokensFloor, undefined);
});

test('an install that predates presets picks up its provider without touching settings', () => {
  const legacy = { enabled: true, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_x', model: 'llama-3.1-8b-instant' };
  const out = withPreset(legacy);
  assert.equal(out.preset, 'groq');
  assert.equal(out.maxTokensFloor, 8192, 'the 16000 floor would 400 every call on Groq');
  // connection facts are never rewritten
  assert.equal(out.baseUrl, legacy.baseUrl);
  assert.equal(out.apiKey, legacy.apiKey);
  assert.equal(out.model, legacy.model);
  assert.deepEqual(legacy, { enabled: true, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_x', model: 'llama-3.1-8b-instant' }, 'input must not be mutated');
});

test('a value the user set explicitly always beats the catalogue', () => {
  assert.equal(withPreset({ preset: 'anthropic' }).jsonMode, false);
  assert.equal(withPreset({ preset: 'anthropic', jsonMode: true }).jsonMode, true);
  assert.equal(withPreset({ preset: 'groq', maxTokensFloor: 4096 }).maxTokensFloor, 4096);
});

test('compat resolves per MODEL, not just per provider', () => {
  // OpenAI serves gpt-4o-mini and the reasoning line from one base URL: a provider-level flag
  // would break the cheap model to accommodate the expensive one.
  const openai = { preset: 'openai', apiKey: 'sk', baseUrl: 'https://api.openai.com/v1' };
  assert.equal(withPreset(openai, 'gpt-4o-mini').maxTokensParam, undefined);
  assert.equal(withPreset(openai, 'gpt-4o-mini').omitTemperature, undefined);
  assert.equal(withPreset(openai, 'gpt-5-mini').maxTokensParam, 'max_completion_tokens');
  assert.equal(withPreset(openai, 'gpt-5-mini').omitTemperature, true);
});

test('a keyless local provider gets a key at read time, never in the database', () => {
  const saved = { enabled: true, preset: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' };
  assert.equal(withPreset(saved).apiKey, 'local');
  assert.equal(saved.apiKey, '', 'the stored blob stays honest');
  // a provider that DOES need a key is left empty, so llmEnabled still refuses it
  assert.equal(withPreset({ preset: 'groq', apiKey: '' }).apiKey, '');
});

test('OpenRouter sends its attribution headers, and a caller can still add its own', () => {
  const out = withPreset({ preset: 'openrouter', apiKey: 'k' });
  assert.equal(out.extraHeaders['X-Title'], 'AI Video Studio');
  assert.ok(out.extraHeaders['HTTP-Referer']);
  const overridden = withPreset({ preset: 'openrouter', apiKey: 'k', extraHeaders: { 'X-Title': 'Mine' } });
  assert.equal(overridden.extraHeaders['X-Title'], 'Mine');
});

test('lane filters and the public catalogue', () => {
  const image = presetsForLane('image').map((p) => p.id);
  assert.ok(image.includes('openai') && image.includes('gemini'), image.join(','));
  assert.ok(!image.includes('groq'), 'Groq serves no images');
  assert.ok(presetsForLane('tts').map((p) => p.id).includes('groq'), 'Groq does serve speech');

  const pub = publicCatalog((model) => (model ? [1, 2] : null));
  assert.equal(pub.length, LLM_PRESETS.length);
  const groq = pub.find((p) => p.id === 'groq');
  assert.equal(groq.compat, undefined, 'compat is internal — the panel has no use for it');
  assert.deepEqual(groq.models[0].price, [1, 2]);
  assert.equal(typeof groq.lanes.image, 'boolean');
});

test('an unknown preset id is safe', () => {
  assert.equal(presetById('nope'), null);
  assert.equal(withPreset({ preset: 'nope', baseUrl: 'https://x.example/v1' }).preset, 'nope');
  assert.equal(codegenModelFor({ preset: 'nope' }), '');
});
