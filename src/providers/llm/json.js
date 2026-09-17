// Robust JSON chat: fence-strip, truncation repair, response_format on the first attempt only (P2), one cooler retry.
import { aiSettings } from '../../db/index.js';
import { safeJson } from '../../util/util.js';
import { withPreset } from '../llm-presets.js';
import { chat } from './transport.js';

// ---- robust JSON chat: fence-strip + truncation repair + one cooler retry ----
function stripFences(s) {
  return String(s || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}
// Salvage truncated JSON by closing unbalanced strings/brackets.
function repairJson(s) {
  let out = '';
  let inStr = false, escp = false;
  const stack = [];
  for (const ch of String(s || '')) {
    out += ch;
    if (escp) { escp = false; continue; }
    if (ch === '\\') { if (inStr) escp = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}
export async function chatJson(messages, { maxTokens = 2048, attempts = 2, temperature = 0.7, validate = null, llm = null, budgetMs = Infinity } = {}) {
  let lastErr;
  const started = Date.now();
  const s = withPreset(llm || aiSettings().llm);
  // Gemini-like proxies choke on response_format:json_object (they reply with a bare fence).
  // Try JSON mode once, then fall back to plain replies — the prompts already demand pure
  // JSON and stripFences+repairJson clean up what comes back. jsonMode:false skips it outright.
  const preferJson = s?.jsonMode !== false;
  for (let i = 0; i < attempts; i++) {
    // The budget covers BOTH attempts, not each — the second one exists to retry without JSON
    // mode for proxies that choke on it, and it must not double a caller's wait to do that.
    const left = budgetMs - (Date.now() - started);
    if (left <= 0) break;
    try {
      const out = await chat(messages, { json: preferJson && i === 0, maxTokens, temperature: i ? 0.4 : temperature, llm, budgetMs: left });
      const raw = stripFences(out);
      const parsed = safeJson(raw, null) ?? safeJson(repairJson(raw), null);
      if (!parsed) throw new Error('LLM returned invalid JSON');
      if (validate && !validate(parsed)) throw new Error('LLM JSON has wrong shape');
      return parsed;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
