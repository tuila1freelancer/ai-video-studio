// Versioned price estimates ("ước tính" — shown as estimates, never invoiced truth).
// Update PRICING_VERSION whenever a rate changes so stored est_cost stays interpretable.
// Unknown models fall back to a conservative mid-tier rate rather than reporting $0.

export const PRICING_VERSION = '2026-07';

// USD per 1M tokens: [input, output]. Prefix-matched, longest prefix wins.
const LLM_PER_MTOK = [
  ['gpt-4o-mini', [0.15, 0.60]],
  ['gpt-4o', [2.50, 10.00]],
  ['gpt-4.1-mini', [0.40, 1.60]],
  ['gpt-4.1', [2.00, 8.00]],
  ['gpt-5-mini', [0.25, 2.00]],
  ['gpt-5', [1.25, 10.00]],
  ['o3', [2.00, 8.00]],
  ['o4-mini', [1.10, 4.40]],
  ['claude-haiku', [1.00, 5.00]],
  ['claude-sonnet', [3.00, 15.00]],
  ['claude-opus', [15.00, 75.00]],
  ['claude', [3.00, 15.00]],
  ['gemini-2.5-flash', [0.30, 2.50]],
  ['gemini-2.5-pro', [1.25, 10.00]],
  ['gemini', [0.30, 2.50]],
  ['deepseek', [0.27, 1.10]],
  ['qwen', [0.40, 1.20]],
  ['llama', [0.20, 0.60]],
];
const LLM_DEFAULT = [0.50, 2.00]; // unknown model — conservative mid-tier

// TTS: USD per 1k characters (elevenlabs ≈ creator tier); larvoice bills opaque credits,
// carried through as credits (VND-denominated on their side) with no USD estimate.
const TTS_PER_KCHAR = { elevenlabs: 0.24, openai: 0.015 };

/** Estimate one metered event's USD cost. Free providers (edge/say/pollinations) → 0. */
export function estimateCost({ kind, provider = null, model = null, promptTokens = 0, completionTokens = 0, chars = 0 }) {
  if (kind === 'llm') {
    const m = String(model || '').toLowerCase();
    const hit = LLM_PER_MTOK.filter(([p]) => m.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
    const [inRate, outRate] = hit ? hit[1] : LLM_DEFAULT;
    return (promptTokens / 1e6) * inRate + (completionTokens / 1e6) * outRate;
  }
  if (kind === 'tts') {
    const rate = TTS_PER_KCHAR[String(provider || '').toLowerCase()];
    return rate ? (chars / 1000) * rate : 0;
  }
  return 0;
}
