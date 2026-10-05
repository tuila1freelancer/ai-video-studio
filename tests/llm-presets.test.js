// ai-providers: the provider catalogue. A data file's realistic failure mode is a bad paste — a typo'd
// base URL, a duplicated id, a model list that lost its provider — so these assert the shape
// as hard as the behaviour. The last block stubs fetch to prove what actually reaches the wire,
// including the case that matters most: an unknown endpoint must send exactly what it always did.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, indexHtml } from './_source.mjs';
import {
  LLM_PRESETS, presetById, inferPreset, withPreset, codegenModelFor, presetsForLane, publicCatalog,
} from '../src/providers/llm-presets.js';

const TIERS = new Set(['free', 'cheap', 'premium', 'local', 'custom']);

test('every preset is well formed', () => {
  // Owner order 2026-08-12: the LLM picker offers ONLY Gemini-capable providers, because the
  // script and the HyperFrame graphics run off one setting and a non-Gemini choice makes the
  // second half fail. Thirteen LLM-only entries were deleted; three stay for the image/TTS lanes
  // with lanes.llm:false. So the catalogue is deliberately SMALL now — what has to hold is that
  // every provider still offered for the LLM lane can actually serve it.
  for (const p of LLM_PRESETS.filter((x) => x.lanes?.llm)) {
    assert.ok(p.codegenModel, `${p.id} is offered for the LLM lane without a Gemini codegen model`);
  }
  assert.deepEqual(LLM_PRESETS.filter((x) => x.lanes?.llm).map((x) => x.id), ['gemini', 'openrouter', 'custom']);
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
  assert.equal(out.maxTokensCap, undefined);
});

test('an install that predates presets picks up its provider without touching settings', () => {
  const legacy = { enabled: true, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_x', model: 'llama-3.1-8b-instant' };
  const out = withPreset(legacy);
  assert.equal(out.preset, 'groq');
  assert.equal(out.maxTokensCap, 8192, 'the uncapped 16000 floor would 400 every call on Groq');
  // connection facts are never rewritten
  assert.equal(out.baseUrl, legacy.baseUrl);
  assert.equal(out.apiKey, legacy.apiKey);
  assert.equal(out.model, legacy.model);
  assert.deepEqual(legacy, { enabled: true, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_x', model: 'llama-3.1-8b-instant' }, 'input must not be mutated');
});

test('a value the user set explicitly always beats the catalogue', () => {
  // Gemini's OpenAI layer answers a json_object request with a bare fence, so the catalogue
  // turns JSON mode off — and the owner can still turn it back on.
  assert.equal(withPreset({ preset: 'gemini' }).jsonMode, false);
  assert.equal(withPreset({ preset: 'gemini', jsonMode: true }).jsonMode, true);
  assert.equal(withPreset({ preset: 'groq', maxTokensCap: 4096 }).maxTokensCap, 4096);
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

test('a server on this machine gets a key at read time, never in the database', () => {
  // The named local presets (Ollama, LM Studio) went with the Gemini-only cut, so the rule moved
  // to where it was always true anyway: the ENDPOINT. A gateway on your own machine wants the
  // Authorization header, not a real key, and it is now reached through "Tuỳ chỉnh" where no
  // catalogue flag could describe it.
  const saved = { enabled: true, preset: 'custom', baseUrl: 'http://127.0.0.1:20128/v1', apiKey: '' };
  assert.equal(withPreset(saved).apiKey, 'local');
  assert.equal(saved.apiKey, '', 'the stored blob stays honest');
  assert.equal(withPreset({ preset: 'custom', baseUrl: 'http://localhost:9999/v1', apiKey: '' }).apiKey, 'local');
  // a REMOTE endpoint with no key is left empty, so llmEnabled still refuses it
  assert.equal(withPreset({ preset: 'custom', baseUrl: 'https://api.example.com/v1', apiKey: '' }).apiKey, '');
  assert.equal(withPreset({ preset: 'gemini', apiKey: '' }).apiKey, '');
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

// ---- the routes the panel talks to ----
// Source-anchored, like p42-route-parity: mounting the router for real would need the whole
// server fixture, and everything with logic is covered functionally
// above and below this block.

test('the app can list providers and ask one what models it serves', async () => {
  const routes = sourceOf('src/api/routes.js');
  assert.match(routes, /r\.get\('\/llm\/providers'/);
  assert.match(routes, /r\.post\('\/llm\/models'/);
  assert.match(routes, /publicCatalog\(priceFor\)/, 'one rate table, or the picker and the meter drift');
  assert.match(routes, /data\?\.data \|\| data\?\.models/, 'not every compatible server answers in OpenAI shape');
  // the masked round-trip must hold on the new route too, or listing models would send '••'
  const models = routes.slice(routes.indexOf("r.post('/llm/models'"));
  assert.match(models.slice(0, 900), /String\(b\.apiKey\)\.includes\('••'\)/);
  // testing a keyless local provider must not be refused for having no key
  const testRoute = routes.slice(routes.indexOf("r.post('/llm/test'"));
  const guard = testRoute.indexOf('thiếu Base URL hoặc API Key');
  assert.ok(testRoute.indexOf('withPreset({') > 0 && testRoute.indexOf('withPreset({') < guard,
    'the preset must resolve before the key guard runs');
});

test('the settings panel offers the picker without losing what it already had', async () => {
  const html = indexHtml();
  const modal = html.slice(html.indexOf('id="settingsModal"'), html.indexOf('id="srtModal"'));
  for (const id of ['setLlmOn', 'setLlmUrl', 'setLlmKey', 'setLlmModel', 'btnTestLlm', 'llmTestResult']) {
    assert.ok(modal.includes(`id="${id}"`), `the panel still needs #${id}`);
  }
  for (const id of ['setLlmPreset', 'llmPresetNote', 'llmUrlField', 'llmKeyField', 'btnFetchModels', 'llmModelList']) {
    assert.ok(modal.includes(`id="${id}"`), `the picker needs #${id}`);
  }
  // a datalist, not a select: a select silently blanks a saved model it has no option for,
  // which would downgrade an owner on a custom model the next time they pressed Save
  assert.match(modal, /id="setLlmModel" list="llmModelList"/);
  const js = sourceOf('public/js/features/settings.js');
  assert.match(js, /btnTestLlm/);                      // p42 depends on this
  assert.match(js, /preset: \$\('#setLlmPreset'\)\.value/, 'the chosen provider must be saved');
  assert.match(js, /inferPresetId\(settings\.llm\?\.baseUrl\)/, 'an existing install must be recognised');
});

// ---- one key per provider, remembered ----
// Both bugs below actually happened while building this, and both destroy a real API key the
// owner cannot get back from the app.

const { syncLlmAccounts } = await import('../src/api/routes.js');
const { applyMaskedUpdate } = await import('../src/util/secrets.js');

/** Exactly what PUT /settings does: merge the masked update, then reconcile the accounts. */
function save(prev, body) {
  const next = applyMaskedUpdate(prev, body);
  syncLlmAccounts(prev, next, body.llm);
  return next;
}

test('switching provider remembers the one being left behind', () => {
  // start: a private proxy, key known only at the top level
  const start = { llm: { preset: 'custom', baseUrl: 'https://proxy.example/v1', apiKey: 'sk-REAL', model: 'ag/x', enabled: true } };

  // move to Groq and save. The proxy key must be snapshotted before it is overwritten.
  const onGroq = save(start, { llm: { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk-NEW', model: 'llama-3.1-8b-instant', enabled: true } });
  assert.equal(onGroq.llm.apiKey, 'gsk-NEW');
  assert.equal(onGroq.llm.accounts.custom.apiKey, 'sk-REAL', 'the proxy key must survive being switched away from');
  assert.equal(onGroq.llm.accounts.custom.baseUrl, 'https://proxy.example/v1');
  assert.equal(onGroq.llm.accounts.groq.apiKey, 'gsk-NEW');

  // come back. The panel shows the proxy key MASKED, and '••' means "keep the saved one" —
  // but the saved top-level key is Groq's now, so resolving it there hands the proxy Groq's key.
  const back = save(onGroq, { llm: { preset: 'custom', baseUrl: 'https://proxy.example/v1', apiKey: 'sk-R••', model: 'ag/x', enabled: true } });
  assert.equal(back.llm.apiKey, 'sk-REAL', 'a masked key must resolve against ITS OWN provider');
  assert.equal(back.llm.accounts.groq.apiKey, 'gsk-NEW', 'and Groq keeps its own');
});

test('an emptied provider is actually forgotten, and a fresh key still wins', () => {
  const saved = { llm: { preset: 'groq', apiKey: 'gsk-OLD', model: 'm', baseUrl: 'https://api.groq.com/openai/v1',
    accounts: { groq: { apiKey: 'gsk-OLD', model: 'm' }, gemini: { apiKey: 'AIza-OLD', model: 'g' } } } };

  const typed = save(saved, { llm: { preset: 'groq', apiKey: 'gsk-FRESH', model: 'm', baseUrl: 'https://api.groq.com/openai/v1' } });
  assert.equal(typed.llm.accounts.groq.apiKey, 'gsk-FRESH', 'a typed key beats the remembered one');

  const cleared = save(saved, { llm: { preset: 'groq', apiKey: '', model: '', baseUrl: 'https://api.groq.com/openai/v1' } });
  assert.equal(cleared.llm.accounts.groq, undefined, 'clearing must forget, not silently keep');
  assert.equal(cleared.llm.accounts.gemini.apiKey, 'AIza-OLD', 'and must not touch anyone else');
});

test('a new project pins the codegen model its own provider actually serves', async () => {
  const { mergeConfigLayers } = await import('../src/core/config.js');
  // resolveProjectConfig reads the live settings row, so exercise the layering it relies on:
  // the codegen pin sits UNDER channel/preset/request, and an empty pin means "no opinion".
  const withPin = mergeConfigLayers({ hyperframe: { styleId: 's' } }, { hyperframe: { model: 'gemini-3.1-pro-preview' } });
  assert.equal(withPin.hyperframe.model, 'gemini-3.1-pro-preview');
  assert.equal(withPin.hyperframe.styleId, 's', 'the pin must not replace the rest of the block');
  const overridden = mergeConfigLayers({ hyperframe: { styleId: 's' } }, { hyperframe: { model: 'gemini-3.1-pro-preview' } }, { hyperframe: { model: 'ag/mine' } });
  assert.equal(overridden.hyperframe.model, 'ag/mine', 'a channel/preset/request value still wins');
  // and visuals.js reads `config.hyperframe?.model ? … : baseLlm`, so '' is the no-opinion case
  assert.equal(mergeConfigLayers({}, { hyperframe: { model: '' } }).hyperframe.model, '');
});

test('an image provider can be added by name instead of by URL', async () => {
  const { addEditProvider, removeEditProvider, brandEditConfig } = await import('../src/api/services/brand-gen.js');
  const added = addEditProvider({ presetId: 'gemini', apiKey: 'AIza-x' });
  assert.equal(added.label, 'Google Gemini');
  const cfg = brandEditConfig();
  assert.equal(cfg.provider.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(cfg.provider.apiKey, 'AIza-x');

  // a provider that edits no images is refused rather than registered and failed later
  assert.throws(() => addEditProvider({ presetId: 'groq', apiKey: 'k' }), /không sửa được ảnh/);
  // the hand-typed form still works exactly as before
  const manual = addEditProvider({ label: 'Riêng', baseUrl: 'https://mine.example/v1/', apiKey: 'k' });
  assert.equal(manual.label, 'Riêng');
  removeEditProvider(manual.id);
  removeEditProvider(added.id);
});

// ---- what actually reaches the wire ----

const { chat } = await import('../src/providers/llm.js');

/** Run one chat() against a stubbed fetch and hand back the request it made. */
async function capture(llm, opts = {}) {
  const real = globalThis.fetch;
  let seen = null;
  globalThis.fetch = (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
  };
  try {
    await chat([{ role: 'user', content: 'hi' }], { llm: { enabled: true, ...llm }, ...opts });
  } finally { globalThis.fetch = real; }
  return seen;
}

test('an unrecognised endpoint sends exactly what it always sent', () => {
  // The no-regression net for every module that goes through chat(): the owner's private proxy
  // and every test fixture in this repo live on this path.
  return capture({ baseUrl: 'http://fake.local', apiKey: 'k', model: 'fake-m' }).then((req) => {
    assert.equal(req.url, 'http://fake.local/chat/completions');
    assert.deepEqual(Object.keys(req.body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'temperature']);
    assert.equal(req.body.max_tokens, 16000);
    assert.equal(req.body.stream, false);
    assert.deepEqual(Object.keys(req.headers).sort(), ['Authorization', 'Content-Type']);
  });
});

test('a provider with a completion cap gets the cap, not the 16000 floor', async () => {
  const req = await capture({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'llama-3.1-8b-instant' });
  assert.equal(req.body.max_tokens, 8192, 'the floor would 400 every call on Groq');
  // a caller asking for MORE than the cap is still clamped — that is the point
  const big = await capture({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'llama-3.1-8b-instant' }, { maxTokens: 24000 });
  assert.equal(big.body.max_tokens, 8192);
});

test('a reasoning model renames the token field and drops temperature', async () => {
  const openai = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk' };
  const cheap = await capture({ ...openai, model: 'gpt-4o-mini' });
  assert.equal(cheap.body.max_tokens, 16000);
  assert.equal(typeof cheap.body.temperature, 'number');

  const reasoning = await capture({ ...openai, model: 'gpt-5-mini' });
  assert.equal(reasoning.body.max_completion_tokens, 16000);
  assert.equal(reasoning.body.max_tokens, undefined, 'sending both is a 400');
  assert.equal(reasoning.body.temperature, undefined, 'this line accepts only temperature 1');
});

test("a provider's own headers ride along with the key", async () => {
  const req = await capture({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'openai/gpt-oss-120b' });
  assert.equal(req.headers['X-Title'], 'AI Video Studio');
  assert.equal(req.headers.Authorization, 'Bearer k');
});

test('a local server answers without a key ever being typed', async () => {
  const req = await capture({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3:8b', preset: 'custom' });
  assert.equal(req.headers.Authorization, 'Bearer local');
  assert.equal(req.body.model, 'qwen3:8b');
});

test('walking to a fallback model re-reads that model\'s rules', async () => {
  // gpt-4o-mini first (plain max_tokens), then the reasoning line — the second request must not
  // inherit the first model's answers.
  const real = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = (url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? Promise.resolve(new Response('nope', { status: 401 }))   // dead key → next model
      : Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
  };
  try {
    await chat([{ role: 'user', content: 'hi' }], {
      llm: { enabled: true, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: 'gpt-4o-mini', modelFallback: 'gpt-5-mini' },
    });
  } finally { globalThis.fetch = real; }
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_tokens, 16000);
  assert.equal(bodies[1].max_completion_tokens, 16000);
  assert.equal(bodies[1].max_tokens, undefined);
});
