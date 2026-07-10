// Central retry helper — every pipeline step goes through this so failures are
// retried with backoff, surfaced to the UI, and never silently swallowed.
import { logger } from './log.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * withRetry(fn, opts) — run fn() up to `tries` times.
 * opts: {
 *   tries: 3, delays: [ms,...] (backoff schedule, last value repeats),
 *   label: 'b34 scene 4' (for logs), onRetry(attempt, err) (UI hook),
 *   fatal(err) => true to stop retrying (e.g. user pressed stop)
 * }
 */
export async function withRetry(fn, { tries = 3, delays = [2000, 5000, 12000], label = 'op', onRetry = null, fatal = null } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); }
    catch (e) {
      lastErr = e;
      if (fatal && fatal(e)) throw e;
      if (i < tries - 1) {
        logger.warn(`${label}: attempt ${i + 1}/${tries} failed (${e.message}) — retrying`);
        try { if (onRetry) onRetry(i + 1, e); } catch { /* UI hook must not break the retry */ }
        await sleep(delays[Math.min(i, delays.length - 1)]);
      }
    }
  }
  throw lastErr;
}
