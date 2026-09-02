// Versioned price estimates ("ước tính" — shown as estimates, never invoiced truth).
// Update PRICING_VERSION whenever a rate changes so stored est_cost stays interpretable.
// Unknown models fall back to a conservative mid-tier rate rather than reporting $0.

export const PRICING_VERSION = '2026-08';

// USD per 1M tokens: [input, output]. Prefix-matched, longest prefix wins.
// Rates carry the vendor's own published number where one exists; a family entry (bare
// `gemini`, `llama`, `qwen`) is the catch-all for the variants nobody publishes.
const LLM_PER_MTOK = [
  ['gpt-4o-mini', [0.15, 0.60]],
  ['gpt-4o', [2.50, 10.00]],
  ['gpt-4.1-nano', [0.10, 0.40]],
  ['gpt-4.1-mini', [0.40, 1.60]],
  ['gpt-4.1', [2.00, 8.00]],
  ['gpt-5.4-nano', [0.20, 1.25]],
  ['gpt-5.4-mini', [0.75, 4.50]],
  ['gpt-5-nano', [0.05, 0.40]],
  ['gpt-5-mini', [0.25, 2.00]],
  ['gpt-5', [1.25, 10.00]],
  // OpenAI's open-weight models, served by half the providers in the catalogue.
  ['gpt-oss-20b', [0.075, 0.30]],
  ['gpt-oss-120b', [0.15, 0.60]],
  ['o3', [2.00, 8.00]],
  ['o4-mini', [1.10, 4.40]],
  ['claude-haiku', [1.00, 5.00]],
  ['claude-sonnet', [3.00, 15.00]],
  ['claude-opus', [15.00, 75.00]],
  ['claude', [3.00, 15.00]],
  ['gemini-2.5-flash-lite', [0.10, 0.40]],
  ['gemini-2.5-flash', [0.30, 2.50]],
  ['gemini-2.5-pro', [1.25, 10.00]],
  ['gemini-3.1-flash-lite', [0.25, 1.50]],
  ['gemini-3.5-flash-lite', [0.30, 2.50]],
  ['gemini-3.6-flash', [1.50, 7.50]],
  ['gemini-3.1-pro', [2.00, 12.00]],
  ['gemini', [0.30, 2.50]],
  ['deepseek-v4-flash', [0.14, 0.28]],
  ['deepseek-v4-pro', [0.435, 0.87]],
  ['deepseek', [0.27, 1.10]],
  ['grok-4.3', [1.25, 2.50]],
  ['grok-build', [1.00, 2.00]],
  ['grok', [2.00, 6.00]],
  ['glm', [1.40, 4.40]],
  ['kimi-k3', [3.00, 15.00]],
  ['kimi', [1.20, 4.50]],
  ['minimax', [0.30, 1.20]],
  ['nemotron', [0.05, 0.20]],
  ['qwen3.6-flash', [0.05, 0.20]],
  ['qwen', [0.40, 1.20]],
  ['llama-3.1-8b', [0.05, 0.08]],
  ['llama-3.3-70b', [0.59, 0.79]],
  ['llama', [0.20, 0.60]],
];
const LLM_DEFAULT = [0.50, 2.00]; // unknown model — conservative mid-tier

// The SAME open-weight model costs different money depending on who runs it, so a provider
// may override a family rate. Only genuine divergences belong here — the table above is the
// common case and an override that merely repeats it is noise.
const PROVIDER_PER_MTOK = {
  cerebras: [['gpt-oss-120b', [0.35, 0.75]]],
  together: [['deepseek-v4-pro', [2.10, 4.40]]],
};

// A model running on the owner's own machine bills nothing. NOT the same as a free TIER
// (Groq, Gemini): a quota is not a price, and those providers' paid rates are real.
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio']);

// TTS: USD per 1k characters (elevenlabs ≈ creator tier); larvoice bills opaque credits,
// carried through as credits (VND-denominated on their side) with no USD estimate.
// The cloud three are their standard neural tiers at list price — the meter is an estimate the
// owner sees before spending, not an invoice, and a wrong-by-half number is worth far more than
// the 0 that an unlisted provider reports.
const TTS_PER_KCHAR = {
  elevenlabs: 0.24, openai: 0.015,
  azure: 0.016, google: 0.016, polly: 0.016,
};

// Aggregators namespace their model ids and OpenRouter suffixes its variants:
//   openai/gpt-4o-mini · google/gemini-2.5-flash · deepseek-ai/DeepSeek-V4-Flash
//   accounts/fireworks/models/llama-v3p1-70b · models/gemini-2.5-flash · qwen/qwen3-32b:free
// Matching the raw string alone missed every one of them, so the meter billed the whole
// cheap half of the catalogue at LLM_DEFAULT — 4× over on gemini-flash, 5× on deepseek.
// Match the tail segment too, so a namespaced id prices like the family it belongs to.
function modelKeys(model) {
  const m = String(model || '').toLowerCase().trim().replace(/:(free|nitro|floor|extended)$/, '');
  const tail = m.slice(m.lastIndexOf('/') + 1);
  return m === tail ? [m] : [m, tail];
}

function longestPrefix(table, keys) {
  return table
    .filter(([p]) => keys.some((k) => k.startsWith(p)))
    .sort((a, b) => b[0].length - a[0].length)[0];
}

/**
 * The per-1M-token rate a model bills at, or null when nothing is known about it.
 * Exported so the settings API can label a model picker with the same number the cost
 * meter will later charge — one table, so the two can never disagree.
 * @returns {[number, number]|null} [input, output] USD per 1M tokens
 */
export function priceFor(model, provider = null) {
  const raw = String(model || '').toLowerCase().trim();
  if (!raw) return null;
  const p = String(provider || '').toLowerCase();
  if (LOCAL_PROVIDERS.has(p)) return [0, 0];
  // OpenRouter's `:free` variants really are free — reporting a mid-tier guess for them
  // would make the cheapest option in the app look like the second most expensive.
  if (/:free$/.test(raw)) return [0, 0];
  const keys = modelKeys(raw);
  const hit = (PROVIDER_PER_MTOK[p] && longestPrefix(PROVIDER_PER_MTOK[p], keys)) || longestPrefix(LLM_PER_MTOK, keys);
  return hit ? hit[1] : null;
}

/** Estimate one metered event's USD cost. Free providers (edge/say/local models) → 0. */
export function estimateCost({ kind, provider = null, model = null, promptTokens = 0, completionTokens = 0, chars = 0 }) {
  if (kind === 'llm') {
    const [inRate, outRate] = priceFor(model, provider) || LLM_DEFAULT;
    return (promptTokens / 1e6) * inRate + (completionTokens / 1e6) * outRate;
  }
  if (kind === 'tts') {
    const rate = TTS_PER_KCHAR[String(provider || '').toLowerCase()];
    return rate ? (chars / 1000) * rate : 0;
  }
  return 0;
}
