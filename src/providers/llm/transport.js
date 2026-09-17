// OpenAI-compatible chat transport: presets, key rotation, the 429 back-off ladder (P3), the max_tokens floor (P1), SSE fallback parsing.
import { aiSettings } from '../../db/index.js';
import { recordUsage } from '../../util/usage.js';
import { withPreset } from '../llm-presets.js';
import { lang as langRow } from '../../i18n/languages.js';
import { m } from '../../i18n/t.js';

/** The language's own forward connectors, quoted for a prompt. */
export const connectorList = (code) => langRow(code).connectors.map((c) => `"${c}"`).join(', ');
/** The narration register note for this language, or nothing when it has none. */
export const voiceNoteFor = (code) => langRow(code).voiceNote || '';

// llm param (optional) = a resolved settings.llm object (e.g. per-channel override);
// omitted → global settings, exactly as before.
//
// ai-providers: every entry point resolves through withPreset() first, so the provider's own quirks
// (token cap, header, JSON mode) arrive without a single one of the ~20 modules that gate on
// llmEnabled having to change. The predicate itself is untouched — a local server that ignores
// its key gets one synthesised there, which is why "has a key" still means what it always did.
export function llmEnabled(llm) {
  const s = withPreset(llm || aiSettings().llm);
  return !!(s && s.enabled && s.apiKey && s.baseUrl);
}

// A dead-key error (bad auth / out of credit) — retrying the same key is pointless,
// rotate to the next one immediately. Transient errors back off and retry the same key.
const DEAD_KEY = /\b40[13]\b|invalid[_ ]?api[_ ]?key|incorrect api key|quota|credit|insufficient/i;

/**
 * `budgetMs` — a wall-clock ceiling on the WHOLE retry ladder, for callers a human is waiting on.
 *
 * The ladder below is built for work that is worth waiting for: on a 429 it backs off 8s, then
 * 20s, then 45s, per key, per model — and chatJson runs the whole thing twice. Measured on a
 * rate-limited proxy that is 163 seconds, which is correct for writing a script and absurd for a
 * button. A caller that passes a budget stops retrying once the next wait would exceed it and
 * fails fast enough to fall back to something. Default Infinity: every existing caller is
 * unchanged, deliberately.
 */
export async function chat(messages, { json = false, temperature = 0.8, maxTokens = 2048, timeoutMs = 120000, llm = null, budgetMs = Infinity } = {}) {
  const s = withPreset(llm || aiSettings().llm);
  if (!llmEnabled(s)) throw new Error('LLM not configured');
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  // apiKey may hold SEVERAL keys (newline/comma-separated) — rotate through them; an optional
  // modelFallback is tried with every key after the primary model exhausts all keys.
  const keys = String(s.apiKey).split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean);
  const models = [s.model || 'gpt-4o-mini', ...(s.modelFallback && s.modelFallback !== s.model ? [String(s.modelFallback)] : [])];
  let lastErr;
  const RATE_LIMIT = /\b429\b|rate.?limit|too many requests/i;
  const RL_DELAYS = [8000, 20000, 45000];
  for (const model of models) {
    for (const apiKey of keys) {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (left() <= 0) throw lastErr || new Error(m('LLM hết thời gian cho phép'));
        try {
          // Never let one request outlive the budget it was given. Re-resolve per model: the
          // token field and the temperature rule belong to the MODEL, so walking to a fallback
          // must re-read them rather than carry the primary model's answers along.
          return await chatOnce({ ...withPreset(s, model), apiKey, model }, messages, { json, temperature, maxTokens, timeoutMs: Math.min(timeoutMs, Math.max(1000, left())) });
        } catch (e) {
          lastErr = e;
          const msg = String(e.message);
          const wait = (ms) => (ms < left() ? new Promise((r) => setTimeout(r, ms)) : null);
          // 429 first: a rate limit is NOT a dead key (even when the body mentions "quota") —
          // it clears with time, so back off long and retry the same key.
          if (RATE_LIMIT.test(msg)) {
            const w = attempt < 3 ? wait(RL_DELAYS[attempt]) : null;
            if (w) { await w; continue; }
            break; // still limited after ~1min of backoff (or out of budget) → next key/model
          }
          if (DEAD_KEY.test(msg)) break; // dead key → next key now
          if (attempt >= 1) break;       // other transient: 2 tries then move on
          const w = wait(1800);
          if (!w) break;
          await w;
        }
      }
      if (left() <= 0) break;
    }
  }
  throw lastErr;
}

async function chatOnce(s, messages, { json, temperature, maxTokens, timeoutMs }) {
  // Reasoning models (gemini-*-low, o*, gpt-5*) burn max_tokens on hidden thinking BEFORE the
  // visible reply — a tight cap returns a truncated mid-thought fragment. Give every call a
  // generous floor (the reference app sends 100k for gemini-like backends); providers simply
  // stop earlier when done. Tune with llm.maxTokensFloor if a backend rejects large caps.
  const floor = Number(s.maxTokensFloor) > 0 ? Number(s.maxTokensFloor) : 16000;
  // …and a CEILING, because a floor cannot lower anything. Groq, DeepSeek and Cerebras enforce
  // a per-model completion cap and answer 400 rather than trimming, so the generous floor above
  // — and codegen's 24000 ask — would fail every single call there. Absent by default: an
  // unknown endpoint keeps the uncapped behaviour this app has always had.
  const ceiling = Number(s.maxTokensCap) > 0 ? Number(s.maxTokensCap) : Infinity;
  const cap = Math.min(Math.max(maxTokens, floor), ceiling);
  // Three more ways a provider can differ from the OpenAI baseline, all supplied by the preset
  // (providers/llm-presets.js) and all absent by default:
  //   · the reasoning line renamed max_tokens and accepts only temperature 1
  //   · OpenRouter wants attribution headers
  const tokenKey = s.maxTokensParam === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens';
  const body = {
    model: s.model || 'gpt-4o-mini', messages,
    ...(s.omitTemperature ? {} : { temperature }),
    [tokenKey]: cap, stream: false,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  // users often paste the FULL endpoint as baseUrl — normalize so both forms work
  const base = s.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}`, ...(s.extraHeaders || {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.usage) {
      recordUsage('llm', { provider: s.preset || null, model: body.model, promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens });
    }
    return data.choices?.[0]?.message?.content || '';
  } catch {
    // some proxies stream SSE regardless of stream:false — concatenate the delta chunks
    let out = '';
    let usage = null; // some backends attach usage to the final SSE chunk
    for (const line of text.split(/\n/)) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m || m[1] === '[DONE]') continue;
      try {
        const j = JSON.parse(m[1]);
        out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
        if (j.usage) usage = j.usage;
      } catch { /* partial keep-alive line */ }
    }
    if (!out) throw new Error(`LLM unparseable response: ${text.slice(0, 200)}`);
    if (usage) recordUsage('llm', { provider: s.preset || null, model: body.model, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
    return out;
  }
}
