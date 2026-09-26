// Licensing client for the Tools Platform store.
//
// Hand-port of `packages/sdk/src/index.ts` from the store repo (synced 2026-08-06). This app has
// no TypeScript build, so the SDK cannot be consumed as a package; keeping a vendored copy here
// is deliberate — the whole `src/license/` folder is the unit another app copies wholesale.
//
// Two deviations from the upstream SDK, both because this copy runs on a customer's laptop
// rather than on a server:
//   - every request has a timeout, so a store that is down cannot hang the app's boot;
//   - errors are CLASSIFIED. "No network" and "your licence was revoked" look identical to a
//     `fetch` that rejects, and treating the first like the second would lock a paying customer
//     out of their own work the moment their wifi drops.
import { createHash, createVerify, randomBytes } from 'node:crypto';

import { m } from '../i18n/t.js';
import { safeJson } from '../util/util.js';
const REQUEST_TIMEOUT_MS = 10_000;

/** Thrown for anything the store answered. `.status` is the HTTP code. */
export class StoreError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
    this.body = body;
  }
}

/** Thrown when the store could not be reached at all. Never a reason to lock the app. */
export class OfflineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OfflineError';
  }
}

export class LicenseClient {
  constructor({ apiKey, baseUrl, timeoutMs = REQUEST_TIMEOUT_MS }) {
    if (!baseUrl) throw new Error('LicenseClient requires a store baseUrl');
    if (!apiKey) throw new Error('LicenseClient requires an apiKey');
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          'x-api-key': this.apiKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // DNS failure, refused connection, timeout — the store said nothing at all.
      throw new OfflineError(e?.message || m('không kết nối được tới cửa hàng'));
    }
    const text = await res.text().catch(() => '');
    const json = text ? safeJson(text, null) : null;
    if (!res.ok) {
      throw new StoreError(res.status, json?.message || text || `HTTP ${res.status}`, json);
    }
    return json;
  }

  activate(licenseKey, deviceId, deviceInfo) {
    return this.request('POST', '/licenses/activate', { licenseKey, deviceId, deviceInfo });
  }

  validate(licenseKey, deviceId) {
    return this.request('POST', '/licenses/validate', { licenseKey, deviceId });
  }

  subscriptionStatus(licenseKey) {
    return this.request('GET', `/subscriptions/status?licenseKey=${encodeURIComponent(licenseKey)}`);
  }

  latestVersion({ platform, channel = 'stable' } = {}) {
    const q = new URLSearchParams({ channel });
    if (platform) q.set('platform', platform);
    return this.request('GET', `/versions/latest?${q}`);
  }

  createDownload({ licenseKey, deviceId, versionId, platform, channel }) {
    return this.request('POST', '/downloads', { licenseKey, deviceId, versionId, platform, channel });
  }

  async publicKey() {
    const result = await this.request('GET', '/public-key');
    return result.publicKey;
  }
}


/**
 * Verify an RS256 licence token against a public key — no network involved.
 * Returns the claims, or throws with a `.reason` the state machine can act on.
 */
export function verifyLicenseToken(token, publicKeyPem) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw tokenError('malformed', m('license token không đúng định dạng'));
  const [headerB64, payloadB64, signatureB64] = parts;

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  let ok = false;
  try {
    ok = verifier.verify(publicKeyPem, Buffer.from(signatureB64, 'base64url'));
  } catch {
    ok = false; // a malformed public key must read as "not verified", never as a crash
  }
  if (!ok) throw tokenError('invalid-signature', m('chữ ký license không hợp lệ'));

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw tokenError('malformed', m('không đọc được nội dung license token'));
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw tokenError('token-expired-offline', m('license token đã quá hạn, cần kết nối mạng để làm mới'));
  }
  return claims;
}

function tokenError(reason, message) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

/** True while the licence may still run offline: inside its grace window, or a lifetime key. */
export function isWithinGrace(claims, now = new Date()) {
  if (!claims?.graceUntil) return true;
  return new Date(claims.graceUntil).getTime() >= now.getTime();
}

// ============================================================================
// Desktop sign-in bridge (client half)
//
// RFC 8252 with PKCE. The app opens a loopback port, sends the owner to the
// store's own page, and trades the one-time code for a link token.
//
// Two things travel with the machine half of the flow: the client key baked
// into this build, which is how the store knows WHICH PRODUCT is asking — no
// slug is ever typed into the app, so renaming a product in the store cannot
// strand a paying customer — and the PKCE verifier, which proves the program
// redeeming the code is the one that started the flow.
// ============================================================================

/** The public half of a client key — `pk_xxxxxxxx.<secret>` — safe to put in a URL. */
export function clientKeyPrefix(apiKey) {
  return String(apiKey || '').split('.')[0];
}

/** An unguessable, URL-safe nonce for the loopback round-trip. */
export function randomState() {
  return randomBytes(24).toString('base64url');
}

/** A PKCE pair: the secret stays here, only its digest goes through the browser. */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** The store page the system browser opens to start a sign-in. */
export function desktopLinkUrl(webBase, { client, state, challenge, port, label, platform }) {
  const origin = String(webBase).replace(/\/+$/, '');
  const params = new URLSearchParams({ client, state, challenge, port: String(port) });
  if (label) params.set('label', label);
  if (platform) params.set('platform', platform);
  return `${origin}/link/desktop?${params}`;
}

async function desktopRequest(baseUrl, apiKey, path, body) {
  const origin = String(baseUrl).replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OfflineError(e?.message || m('không kết nối được tới cửa hàng'));
  }
  const text = await res.text().catch(() => '');
  const json = text ? safeJson(text, null) : null;
  if (!res.ok) {
    throw new StoreError(res.status, json?.message || text || `HTTP ${res.status}`, json);
  }
  return json;
}

/** Trade the one-time code from the loopback redirect for the link token. */
export function exchangeDesktopCode(baseUrl, apiKey, { code, verifier }) {
  return desktopRequest(baseUrl, apiKey, '/api/auth/desktop/exchange', { code, verifier });
}

/**
 * Ask the store who this machine is linked to and what it owns.
 *
 * The answer is already narrowed to this product by the client key, so the app
 * never filters licences by name — there is no name to get wrong.
 */
export function desktopSession(baseUrl, apiKey, token) {
  return desktopRequest(baseUrl, apiKey, '/api/auth/desktop/session', { token });
}

/** Sign this machine out at the store, so the token stops working everywhere. */
export function desktopRevoke(baseUrl, apiKey, token) {
  return desktopRequest(baseUrl, apiKey, '/api/auth/desktop/revoke', { token });
}
