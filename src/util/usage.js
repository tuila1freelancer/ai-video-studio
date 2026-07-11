// Provider usage capture — the single seam every metered call reports through.
// In-memory aggregate now; the cost meter (persisted per-project accounting) subscribes
// via onUsage without any provider needing to change again.

const totals = { llm: { calls: 0, promptTokens: 0, completionTokens: 0 }, tts: { calls: 0, chars: 0, credits: 0 } };
const listeners = new Set();

/**
 * Record one metered provider event.
 * @param {'llm'|'tts'} kind
 * @param {object} data llm: {provider?, model, promptTokens, completionTokens} ·
 *                      tts: {provider, chars?, credits?, voice?}
 */
export function recordUsage(kind, data) {
  const d = data || {};
  if (kind === 'llm') {
    totals.llm.calls++;
    totals.llm.promptTokens += Number(d.promptTokens) || 0;
    totals.llm.completionTokens += Number(d.completionTokens) || 0;
  } else if (kind === 'tts') {
    totals.tts.calls++;
    totals.tts.chars += Number(d.chars) || 0;
    totals.tts.credits += Number(d.credits) || 0;
  }
  for (const fn of listeners) { try { fn(kind, d); } catch { /* listener must never break a provider call */ } }
}

/** Subscribe to usage events (cost meter). Returns an unsubscribe function. */
export function onUsage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Process-lifetime aggregate (diagnostics). */
export function usageTotals() { return JSON.parse(JSON.stringify(totals)); }
