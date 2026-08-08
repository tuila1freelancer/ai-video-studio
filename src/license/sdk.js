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
import { createVerify, randomBytes } from 'node:crypto';

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
      throw new OfflineError(e?.message || 'không kết nối được tới cửa hàng');
    }
    const text = await res.text().catch(() => '');
    const json = text ? safeJson(text) : null;
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

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Verify an RS256 licence token against a public key — no network involved.
 * Returns the claims, or throws with a `.reason` the state machine can act on.
 */
export function verifyLicenseToken(token, publicKeyPem) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw tokenError('malformed', 'license token không đúng định dạng');
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
  if (!ok) throw tokenError('invalid-signature', 'chữ ký license không hợp lệ');

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw tokenError('malformed', 'không đọc được nội dung license token');
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw tokenError('token-expired-offline', 'license token đã quá hạn, cần kết nối mạng để làm mới');
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
// Mirrors the desktop-auth helpers in `@tools/sdk`. The app starts a loopback
// listener, opens the browser at `desktopAuthorizeUrl(...)`, trades the
// one-time code for a JWT pair, then finds the customer's licence with
// `listMyLicenses(...)` — nobody types a licence key.
// ============================================================================

/** An unguessable, URL-safe `state` for the loopback flow. */
export function randomState() {
  return randomBytes(24).toString('base64url');
}

/** The URL the system browser opens to start a desktop sign-in. */
export function desktopAuthorizeUrl(baseUrl, { state, port }) {
  const origin = String(baseUrl).replace(/\/+$/, '');
  const params = new URLSearchParams({ state, port: String(port) });
  return `${origin}/api/auth/desktop/authorize?${params}`;
}

async function desktopRequest(baseUrl, path, body) {
  const origin = String(baseUrl).replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OfflineError(e?.message || 'không kết nối được tới cửa hàng');
  }
  const text = await res.text().catch(() => '');
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new StoreError(res.status, json?.message || text || `HTTP ${res.status}`, json);
  }
  return json;
}

/** Trade the one-time code from the loopback redirect for a session. */
export function exchangeDesktopCode(baseUrl, code) {
  return desktopRequest(baseUrl, '/api/auth/desktop/exchange', { code });
}

/** Rotate a stored session before its access token runs out. */
export function refreshDesktopSession(baseUrl, refreshToken) {
  return desktopRequest(baseUrl, '/api/auth/desktop/refresh', { refreshToken });
}

/** Development-only: a session for any email while the store runs without Google. */
export function desktopDevLogin(baseUrl, email) {
  return desktopRequest(baseUrl, '/api/auth/desktop/dev-login', { email });
}

/** The signed-in customer's licences, for picking the one this app activates. */
export async function listMyLicenses(baseUrl, accessToken) {
  const origin = String(baseUrl).replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${origin}/api/me/licenses`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OfflineError(e?.message || 'không kết nối được tới cửa hàng');
  }
  const text = await res.text().catch(() => '');
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new StoreError(res.status, json?.message || text || `HTTP ${res.status}`, json);
  }
  return Array.isArray(json) ? json : [];
}
