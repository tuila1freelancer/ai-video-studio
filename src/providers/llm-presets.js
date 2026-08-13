// The providers the app knows how to talk to, as DATA.
//
// Every one of them speaks the same protocol — POST {baseUrl}/chat/completions with a Bearer
// key — so there is deliberately no per-provider code and no directory like providers/voice/.
// A preset only pre-fills what the user would otherwise have to know: the base URL, where to
// get a key, which models exist, and the handful of ways that provider deviates from the
// OpenAI baseline.
//
// This module imports nothing from db/ or llm.js: it is pure data plus pure functions, so
// llm.js can import IT without a cycle and the tests need no database.
//
// Two rules learned the hard way:
//   1. `compat` has TWO layers. `max_completion_tokens` and "temperature must be 1" are
//      properties of a MODEL, not of a provider — OpenAI serves gpt-4o-mini and gpt-5 from the
//      same base URL. A preset-level flag would break the cheap model to accommodate the
//      expensive one, so models[].compat overrides preset.compat and withPreset() is called
//      again for each model chat() walks.
//   2. No preset ever ships a `modelFallback`. The no-fallback contract (P25) exists because a
//      silent model swap looks like success while quietly degrading quality; a fallback baked
//      into the catalogue would re-introduce exactly that on every non-codegen path.
//
// Model ids drift constantly. Treat the lists here as a starting point, not as truth — the
// settings panel can ask the provider itself (GET {baseUrl}/models) and the model field stays
// free-text on purpose.

/**
 * @typedef {object} LlmPreset
 * @property {string} id
 * @property {string} label
 * @property {'free'|'cheap'|'premium'|'local'|'custom'} tier drives the <optgroup> grouping
 * @property {string} baseUrl OpenAI-compatible root; '' means the user types their own
 * @property {string} [keyUrl] where a user creates a key
 * @property {string} [note] one Vietnamese line shown under the picker
 * @property {boolean} [noCard] usable today without a payment method
 * @property {boolean} [keyless] a local server that ignores the key entirely
 * @property {boolean} [listsModels] GET {baseUrl}/models works
 * @property {boolean} [modelsVerified] the ids below were confirmed against the live catalogue
 * @property {string|null} codegenModel HyperFrame's model, or null when this provider has no Gemini
 * @property {object} lanes which stages this provider can serve
 * @property {object} [compat] deviations from the OpenAI baseline —
 *   maxTokensCap · maxTokensFloor · maxTokensParam · omitTemperature · jsonMode · extraHeaders
 * @property {Array<{id:string,label:string,compat?:object}>} models
 */

// HyperFrame writes the scene graphics as code, and measured against every other family only
// Gemini produces markup that renders — owner's call, 2026-08-13. So `codegenModel` is set
// ONLY on providers that actually serve a Gemini model; everywhere else it is null and the
// settings panel says so out loud, because today the mismatch only surfaces as a render
// failure ten attempts deep (codegen strips modelFallback, so it cannot degrade quietly).
const GEMINI_CODEGEN = 'gemini-3.1-pro-preview';

// Owner order 2026-08-12: the LLM picker offers ONLY providers that can serve Gemini, because
// the script and the HyperFrame graphics run on the same setting and a non-Gemini choice makes
// the second one fail. Thirteen catalogue entries that served nothing but a non-Gemini LLM lane
// were deleted outright (Cerebras · Mistral · DeepSeek · xAI · Moonshot · Z.ai · Fireworks ·
// Novita · Nebius · SambaNova · Anthropic · Ollama · LM Studio) — all of them still reachable
// through "Tuỳ chỉnh" for anyone who wants one.
//
// Three others stay in the catalogue with `lanes.llm: false`: Groq, Together and OpenAI are the
// only presets serving the IMAGE or TTS lanes, and deleting them would take a working picker
// down with a rule about a different lane. They no longer appear under the LLM provider list.

/** @type {LlmPreset[]} */
export const LLM_PRESETS = [
  // ---- free / has a real free tier ----
  {
    id: 'gemini',
    label: 'Google Gemini',
    tier: 'free',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Miễn phí, không cần thẻ. Lựa chọn tốt nhất.',
    noCard: true,
    listsModels: true,
    modelsVerified: true,
    codegenModel: GEMINI_CODEGEN,
    lanes: { llm: true, image: { model: 'gemini-2.5-flash-image' }, tts: { model: 'gemini-2.5-flash-preview-tts' } },
    // Gemini's compatibility layer answers a json_object request with a bare fence instead of
    // JSON (the reason chatJson has a no-JSON-mode retry at all). Skip the doomed first attempt.
    compat: { jsonMode: false },
    models: [
      { id: 'gemini-2.5-flash-lite', label: 'rẻ nhất' },
      { id: 'gemini-3.5-flash-lite', label: 'cân bằng' },
      { id: 'gemini-3.6-flash', label: 'mạnh' },
      { id: GEMINI_CODEGEN, label: 'mạnh nhất — dựng đồ hoạ' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    tier: 'free',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Chỉ dùng cho giọng đọc.',
    noCard: true,
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    // llm: false — no Gemini, so it cannot serve the script/HyperFrame lane. Kept for its TTS.
    lanes: { llm: false, image: false, tts: { model: 'playai-tts' } },
    // Groq enforces a per-model completion cap (commonly 8192) and answers 400 rather than
    // trimming, so the uncapped 16000 floor would fail every single call.
    compat: { maxTokensCap: 8192 },
    models: [
      { id: 'llama-3.1-8b-instant', label: 'rẻ & nhanh' },
      { id: 'openai/gpt-oss-20b', label: 'cân bằng' },
      { id: 'openai/gpt-oss-120b', label: 'mạnh' },
      { id: 'llama-3.3-70b-versatile', label: 'mạnh, dài hơi' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tier: 'free',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Một key cho mọi model, có Gemini.',
    noCard: true,
    listsModels: true,
    modelsVerified: true,
    codegenModel: `google/${GEMINI_CODEGEN}`,
    lanes: { llm: true, image: false, tts: false },
    // OpenRouter attributes traffic by these headers; they are optional, but sending them is
    // how the app shows up as itself instead of as anonymous traffic.
    compat: { extraHeaders: { 'HTTP-Referer': 'https://tuila1freelancer.com', 'X-Title': 'AI Video Studio' } },
    models: [
      { id: 'google/gemini-2.5-flash-lite', label: 'rẻ nhất' },
      { id: 'deepseek/deepseek-v4-flash', label: 'rẻ, viết tốt' },
      { id: 'openai/gpt-oss-120b', label: 'cân bằng' },
      { id: `google/${GEMINI_CODEGEN}`, label: 'mạnh nhất — dựng đồ hoạ' },
    ],
  },

  // ---- kept for the image / TTS lanes only ----
  {
    id: 'together',
    label: 'Together AI',
    tier: 'cheap',
    baseUrl: 'https://api.together.ai/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    note: 'Chỉ dùng cho ảnh và giọng đọc.',
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    // llm: false — no Gemini. Kept for the image and TTS lanes it is the only preset serving.
    lanes: { llm: false, image: { model: 'black-forest-labs/FLUX.1-schnell' }, tts: { model: 'cartesia/sonic' } },
    models: [
      { id: 'openai/gpt-oss-20b', label: 'rẻ & nhanh' },
      { id: 'openai/gpt-oss-120b', label: 'mạnh' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    tier: 'premium',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Chỉ dùng cho ảnh và giọng đọc.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    // llm: false — no Gemini. Kept for the image and TTS lanes.
    lanes: { llm: false, image: { model: 'gpt-image-2' }, tts: { model: 'gpt-4o-mini-tts' } },
    models: [
      { id: 'gpt-4o-mini', label: 'rẻ & quen thuộc' },
      // The reasoning line renamed the token field and accepts only temperature 1 — model
      // facts, not provider facts, which is exactly why compat nests here.
      { id: 'gpt-5-nano', label: 'rẻ nhất', compat: { maxTokensParam: 'max_completion_tokens', omitTemperature: true } },
      { id: 'gpt-5-mini', label: 'cân bằng', compat: { maxTokensParam: 'max_completion_tokens', omitTemperature: true } },
      { id: 'gpt-5.4-mini', label: 'mạnh', compat: { maxTokensParam: 'max_completion_tokens', omitTemperature: true } },
    ],
  },

  // ---- anything else ----
  {
    id: 'custom',
    label: '✏️ Tuỳ chỉnh (tự nhập Base URL)',
    tier: 'custom',
    baseUrl: '',
    note: 'Endpoint chuẩn OpenAI — proxy riêng, gateway nội bộ.',
    listsModels: true,
    modelsVerified: false,
    // An unrecognised endpoint keeps the model this app has always pinned for codegen, so an
    // existing install on a private proxy behaves exactly as it did before presets existed.
    codegenModel: 'ag/gemini-pro-agent',
    lanes: { llm: true, image: true, tts: true },
    models: [],
  },
];

// Deliberately NOT in this catalogue, so nobody re-adds them by accident:
//   perplexity — mid-migration to a /router/v1 gateway, and every call carries a per-request
//                search fee on top of tokens, which no cost estimate here would show.
//   dashscope  — Alibaba's current base URL embeds a per-user workspace id, so one hardcoded
//                string cannot work for everyone.
//   hyperbolic — its documentation moved twice and every published URL 404s today.
// Any of the three still works through the "Tuỳ chỉnh" entry.

/** A server on this machine — it wants the header, not a real key. */
const LOCAL_ENDPOINT = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

const BY_ID = new Map(LLM_PRESETS.map((p) => [p.id, p]));
const CUSTOM = BY_ID.get('custom');

/** A preset by id, or null. An unknown id must always be safe — settings can hold anything. */
export function presetById(id) {
  return BY_ID.get(String(id || '')) || null;
}

// Normalise exactly the way chatOnce does before it appends /chat/completions, so a base URL
// that already carries the endpoint (people paste the whole thing) still matches its preset.
function normaliseUrl(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

const BY_URL = new Map();
for (const p of LLM_PRESETS) {
  if (p.baseUrl) BY_URL.set(normaliseUrl(p.baseUrl), p.id);
}
const inferCache = new Map();

/**
 * Which preset a saved base URL belongs to — this is what lets an install that predates
 * presets pick up its provider's quirks without the user touching anything.
 * Unknown endpoints resolve to 'custom', which carries no compat flags, so their behaviour
 * is byte-identical to before.
 */
export function inferPreset(baseUrl) {
  const key = normaliseUrl(baseUrl);
  if (!key) return 'custom';
  const cached = inferCache.get(key);
  if (cached) return cached;
  let hit = BY_URL.get(key);
  if (!hit) {
    // host-only match: a provider may serve several paths (…/v1, …/openai/v1) and a proxy
    // path we do not know about should still be recognised as that provider.
    try {
      const host = new URL(key).host;
      for (const p of LLM_PRESETS) {
        if (p.baseUrl && new URL(p.baseUrl).host === host) { hit = p.id; break; }
      }
    } catch { /* not a URL at all — 'custom' is the right answer */ }
  }
  const id = hit || 'custom';
  inferCache.set(key, id);
  return id;
}

/**
 * Resolve a saved `settings.llm` object against its preset.
 *
 * Called at the top of llmEnabled/chat/chatJson, and again per model inside chat's ladder —
 * `model` is what selects the per-model compat layer.
 *
 * Anything the user can actually set (jsonMode, maxTokensFloor) wins when it is present; the
 * catalogue-only knobs are recomputed every time, so shipping a corrected flag in an app
 * update fixes existing installs without a migration.
 */
export function withPreset(s, model = s?.model) {
  if (!s || typeof s !== 'object') return s;
  const id = s.preset || inferPreset(s.baseUrl);
  const p = presetById(id) || CUSTOM;
  const mc = (p.models || []).find((m) => m.id === model)?.compat || {};
  const c = p.compat || {};
  const out = { ...s, preset: id };
  if (out.jsonMode === undefined && (mc.jsonMode ?? c.jsonMode) !== undefined) out.jsonMode = mc.jsonMode ?? c.jsonMode;
  if (out.maxTokensFloor === undefined && (mc.maxTokensFloor ?? c.maxTokensFloor) !== undefined) {
    out.maxTokensFloor = mc.maxTokensFloor ?? c.maxTokensFloor;
  }
  if (out.maxTokensCap === undefined && (mc.maxTokensCap ?? c.maxTokensCap) !== undefined) {
    out.maxTokensCap = mc.maxTokensCap ?? c.maxTokensCap;
  }
  out.maxTokensParam = mc.maxTokensParam ?? c.maxTokensParam;
  out.omitTemperature = mc.omitTemperature ?? c.omitTemperature;
  const headers = mc.extraHeaders || c.extraHeaders;
  if (headers) out.extraHeaders = { ...headers, ...(s.extraHeaders || {}) };
  // A local server requires the field but ignores its value. Synthesised at READ time, never
  // written to the database: a stored fake key would show up masked ('loca••') in the panel
  // and the UI would have to lie about it. This is what keeps llmEnabled's meaning — and all
  // ~20 modules that gate on it — unchanged for a provider that needs no key.
  //
  // The rule is the ENDPOINT's, not the catalogue's. The named local presets (Ollama, LM Studio)
  // went with the Gemini-only cut, but a gateway on your own machine still ignores keys — and
  // that is now reached through "Tuỳ chỉnh", where no catalogue flag can describe it.
  if (!out.apiKey && (p.keyless || LOCAL_ENDPOINT.test(String(out.baseUrl || '')))) out.apiKey = 'local';
  return out;
}

/**
 * The model HyperFrame's codegen should run on for a given LLM config.
 * '' means "no opinion — use the general model", which is what the per-project field already
 * promises when left blank.
 */
export function codegenModelFor(llm) {
  const s = withPreset(llm || {});
  return String(s.codegenModel || presetById(s.preset)?.codegenModel || '');
}

/** Presets that can serve a stage: 'llm' | 'image' | 'tts'. */
export function presetsForLane(lane) {
  return LLM_PRESETS.filter((p) => Boolean(p.lanes?.[lane]));
}

/**
 * The catalogue as the settings panel needs it. It holds no secrets — nothing here ever came
 * from the user — so unlike every other settings egress this one needs no masking.
 * `price` is decorated by the caller from core/pricing.js: one rate table, so the number in
 * the picker and the number in the cost meter cannot disagree.
 */
export function publicCatalog(priceOf = () => null) {
  return LLM_PRESETS.map((p) => ({
    id: p.id, label: p.label, tier: p.tier, baseUrl: p.baseUrl, keyUrl: p.keyUrl || '',
    note: p.note || '', noCard: !!p.noCard, keyless: !!p.keyless,
    listsModels: !!p.listsModels, modelsVerified: !!p.modelsVerified,
    codegenModel: p.codegenModel || null,
    lanes: { llm: !!p.lanes?.llm, image: !!p.lanes?.image, tts: !!p.lanes?.tts },
    models: (p.models || []).map((m) => ({ id: m.id, label: m.label, price: priceOf(m.id, p.id) })),
  }));
}
