// Tell somebody when something happened, without them having to ask.
//
// The event cursor covers an agent that polls; this covers the other half — a Discord channel, an
// n8n flow, a phone — where waiting for the next poll is the wrong answer. Deliveries are signed so
// the receiver can tell a real one from anything else that found the URL, and every failure is
// swallowed: a webhook nobody is listening to must never fail the render it describes.
import { createHmac } from 'node:crypto';
import { getSetting } from '../db/index.js';
import { logger } from '../util/log.js';
import { newId, sleep } from '../util/util.js';

/** Attempts per delivery, and the wait before each retry. */
const BACKOFF_MS = [1000, 5000, 15000];
/** Deliveries allowed in flight at once. Past this, the newest is dropped and said so. */
const MAX_INFLIGHT = 32;
const TIMEOUT_MS = 10_000;

let inflight = 0;

/** The hooks that asked for this kind. A hook with no `kinds` takes everything. */
export function hooksFor(kind, hooks = getSetting('webhooks', []) || []) {
  return (Array.isArray(hooks) ? hooks : [])
    .filter((h) => h?.url && h.active !== false)
    .filter((h) => !Array.isArray(h.kinds) || !h.kinds.length || h.kinds.includes(kind));
}

/** `sha256=<hex>` over the exact body bytes — the receiver verifies what it actually got. */
export function signBody(secret, body) {
  return `sha256=${createHmac('sha256', String(secret || '')).update(body).digest('hex')}`;
}

async function deliver(hook, kind, body, deliveryId) {
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AVS-Event': kind,
          'X-AVS-Delivery': deliveryId,
          ...(hook.secret ? { 'X-AVS-Signature': signBody(hook.secret, body) } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return true;
      // 4xx is the receiver saying no; repeating it changes nothing.
      if (res.status < 500) { logger.warn(`webhook ${kind} → ${res.status}, bỏ qua`); return false; }
    } catch (e) {
      if (attempt === BACKOFF_MS.length - 1) logger.warn(`webhook ${kind} thất bại: ${e.message}`);
    }
    await sleep(BACKOFF_MS[attempt]);
  }
  return false;
}

/**
 * Fire and forget. Returns the number of hooks the event was handed to, for tests and the log —
 * never a promise the caller has to wait on.
 * @param {string} kind e.g. 'job.settled' | 'project.error' | 'project.published' | 'server.degraded'
 * @param {object} data
 */
export function notifyWebhooks(kind, data = {}) {
  let sent = 0;
  try {
    const hooks = hooksFor(kind);
    if (!hooks.length) return 0;
    const body = JSON.stringify({ event: kind, at: Date.now(), data });
    for (const hook of hooks) {
      if (inflight >= MAX_INFLIGHT) { logger.warn(`webhook ${kind}: hàng đợi đầy, bỏ lần gửi này`); break; }
      inflight += 1;
      sent += 1;
      void deliver(hook, kind, body, newId('whk')).finally(() => { inflight -= 1; });
    }
  } catch (e) {
    logger.warn(`webhook ${kind}: ${e.message}`);
  }
  return sent;
}
