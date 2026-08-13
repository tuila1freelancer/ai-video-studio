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

/** @type {LlmPreset[]} */
export const LLM_PRESETS = [
  // ---- free / has a real free tier ----
  {
    id: 'gemini',
    label: 'Google Gemini',
    tier: 'free',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Miễn phí thật, không cần thẻ. Là lựa chọn tốt nhất vì HyperFrame chỉ dựng đẹp bằng Gemini.',
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
    note: 'Miễn phí, không cần thẻ, nhanh nhất. Không có Gemini nên không dựng được HyperFrame.',
    noCard: true,
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: { model: 'playai-tts' } },
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
    id: 'cerebras',
    label: 'Cerebras',
    tier: 'free',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyUrl: 'https://cloud.cerebras.ai',
    note: 'Miễn phí 1 triệu token/ngày, không cần thẻ. Kho model nhỏ.',
    noCard: true,
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    compat: { maxTokensCap: 8192 }, // the free tier also caps context at 8k
    models: [{ id: 'gpt-oss-120b', label: 'mạnh' }],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tier: 'free',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Một key dùng được mọi model, gồm cả Gemini. Có model ":free" miễn phí.',
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
  {
    id: 'mistral',
    label: 'Mistral',
    tier: 'free',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    note: 'Có bậc miễn phí sau khi xác minh số điện thoại.',
    noCard: true,
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    // The `-latest` aliases are Mistral's own stable pointers — a pinned version id goes stale.
    models: [
      { id: 'ministral-8b-latest', label: 'rẻ & nhanh' },
      { id: 'mistral-small-latest', label: 'cân bằng' },
      { id: 'mistral-medium-latest', label: 'mạnh' },
    ],
  },

  // ---- cheap, pay as you go ----
  {
    id: 'deepseek',
    label: 'DeepSeek',
    tier: 'cheap',
    baseUrl: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'Rất rẻ, viết văn tốt. Cần nạp tiền trước, không có bậc miễn phí.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    compat: { maxTokensCap: 8192 },
    models: [
      { id: 'deepseek-v4-flash', label: 'rẻ & nhanh' },
      { id: 'deepseek-v4-pro', label: 'mạnh' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    tier: 'cheap',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    note: 'Giá tăng gấp đôi khi hội thoại vượt 200k token.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [
      { id: 'grok-4.3', label: 'rẻ hơn' },
      { id: 'grok-4.6', label: 'mạnh' },
    ],
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    tier: 'cheap',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.kimi.ai/console/api-keys',
    note: 'Cửa sổ ngữ cảnh rất dài — hợp với video dài, kịch bản dán nguyên bài.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [
      { id: 'kimi-k2.6', label: 'cân bằng' },
      { id: 'kimi-k3', label: 'mạnh, ngữ cảnh 1M' },
    ],
  },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    tier: 'cheap',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    note: 'GLM-5.2 mạnh mà rẻ; có gói thuê bao riêng nếu dùng nhiều.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [
      { id: 'glm-5-turbo', label: 'rẻ & nhanh' },
      { id: 'glm-5.2', label: 'mạnh' },
    ],
  },
  {
    id: 'together',
    label: 'Together AI',
    tier: 'cheap',
    baseUrl: 'https://api.together.ai/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    note: 'Nhiều model mở. Phải nạp tối thiểu $5. Bấm ↻ để lấy đúng tên model.',
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: { model: 'black-forest-labs/FLUX.1-schnell' }, tts: { model: 'cartesia/sonic' } },
    models: [
      { id: 'openai/gpt-oss-20b', label: 'rẻ & nhanh' },
      { id: 'openai/gpt-oss-120b', label: 'mạnh' },
    ],
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    tier: 'cheap',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    note: 'Tên model dạng accounts/…/models/…. Bấm ↻ để lấy đúng tên.',
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [
      { id: 'accounts/fireworks/models/gpt-oss-20b', label: 'rẻ & nhanh' },
      { id: 'accounts/fireworks/models/gpt-oss-120b', label: 'mạnh' },
    ],
  },
  {
    id: 'novita',
    label: 'Novita AI',
    tier: 'cheap',
    baseUrl: 'https://api.novita.ai/openai/v1',
    keyUrl: 'https://novita.ai/settings/key-management',
    note: 'Tài khoản mới có phiếu dùng thử. Bấm ↻ để lấy đúng tên model.',
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [{ id: 'deepseek/deepseek-v3.2', label: 'rẻ' }],
  },
  {
    id: 'nebius',
    label: 'Nebius Token Factory',
    tier: 'cheap',
    baseUrl: 'https://api.tokenfactory.nebius.com/v1',
    keyUrl: 'https://tokenfactory.nebius.com',
    note: 'Đăng nhập bằng Google/GitHub, có ít credit dùng thử. Bấm ↻ để lấy tên model.',
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [{ id: 'deepseek-ai/DeepSeek-V3.2', label: 'rẻ' }],
  },
  {
    id: 'sambanova',
    label: 'SambaNova',
    tier: 'cheap',
    baseUrl: 'https://api.sambanova.ai/v1',
    keyUrl: 'https://cloud.sambanova.ai/apis',
    note: 'Có bậc miễn phí nhưng chỉ 20 lượt/ngày — đủ thử, không đủ dựng video.',
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    // Unnamespaced and capitalised, unlike everyone else in this list.
    models: [{ id: 'Meta-Llama-3.3-70B-Instruct', label: 'mạnh' }],
  },

  // ---- premium ----
  {
    id: 'openai',
    label: 'OpenAI',
    tier: 'premium',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Chuẩn mực, nhưng đắt và thẻ Việt Nam hay bị từ chối.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: { model: 'gpt-image-2' }, tts: { model: 'gpt-4o-mini-tts' } },
    models: [
      { id: 'gpt-4o-mini', label: 'rẻ & quen thuộc' },
      // The reasoning line renamed the token field and accepts only temperature 1 — model
      // facts, not provider facts, which is exactly why compat nests here.
      { id: 'gpt-5-nano', label: 'rẻ nhất', compat: { maxTokensParam: 'max_completion_tokens', omitTemperature: true } },
      { id: 'gpt-5-mini', label: 'cân bằng', compat: { maxTokensParam: 'max_completion_tokens', omitTemperature: true } },
      { id: 'gpt-5.4-mini', label: 'mạnh', compat: { maxTokensParam: 'max_completion_tokens', omitTemperature: true } },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    tier: 'premium',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://platform.claude.com/settings/keys',
    note: 'Viết rất tốt, giá cao. Lớp tương thích OpenAI của họ bỏ qua chế độ JSON.',
    listsModels: true,
    modelsVerified: true,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    // Anthropic documents that its OpenAI-compatible layer ignores response_format outright,
    // so asking for JSON mode buys nothing and costs a wasted first attempt.
    compat: { jsonMode: false },
    models: [
      { id: 'claude-sonnet-4-6', label: 'cân bằng' },
      { id: 'claude-opus-5', label: 'mạnh nhất' },
    ],
  },

  // ---- on the owner's own machine ----
  {
    id: 'ollama',
    label: 'Ollama (máy của bạn)',
    tier: 'local',
    baseUrl: 'http://localhost:11434/v1',
    keyUrl: 'https://ollama.com/download',
    note: 'Chạy offline, không tốn tiền. Cần "ollama pull" model trước; bấm ↻ để xem model đã tải.',
    noCard: true,
    keyless: true,
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (máy của bạn)',
    tier: 'local',
    baseUrl: 'http://localhost:1234/v1',
    keyUrl: 'https://lmstudio.ai',
    note: 'Chạy offline. Phải bật server ở tab Developer của LM Studio trước.',
    noCard: true,
    keyless: true,
    listsModels: true,
    modelsVerified: false,
    codegenModel: null,
    lanes: { llm: true, image: false, tts: false },
    models: [],
  },

  // ---- anything else ----
  {
    id: 'custom',
    label: '✏️ Tuỳ chỉnh (tự nhập Base URL)',
    tier: 'custom',
    baseUrl: '',
    note: 'Bất kỳ endpoint nào nói chuẩn OpenAI chat-completions — proxy riêng, gateway nội bộ…',
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
  if (!out.apiKey && p.keyless) out.apiKey = 'local';
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
