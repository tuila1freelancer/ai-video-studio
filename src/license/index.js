// The app's licence: current verdict, activation, and the background refresh.
//
// Everything the rest of the app needs goes through here. The design in one line: the verdict is
// computed offline from a signed token, and the network is only ever used to REFRESH that token —
// so a store outage, a flaky hotel wifi or a flight never stops someone from finishing a video
// they have already paid for.
import { EventEmitter } from 'node:events';
import { logger } from '../util/log.js';
import { PRODUCT_SLUG, clientApiKey, configured, isDist, publicKeyPem, storeUrl, webUrl } from './config.js';
import { deviceId, deviceInfo } from './device.js';
import { LicenseClient, OfflineError } from './sdk.js';
import { isRunnable, licenseState, reasonText } from './state.js';
import { maskKey, patchStore, readStore, writeStore } from './store.js';

import { m, tp } from '../i18n/t.js';
/** Emits `change` with the new status whenever the verdict moves. */
export const licenseEvents = new EventEmitter();

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const RENEW_TOKEN_BEFORE_MS = 7 * 24 * 60 * 60 * 1000; // renew a token with <7 days left
const STATUS_CACHE_MS = 30_000;

let cache = null;
let timer = null;

/**
 * Development escape hatch.
 *
 * Deliberately dead in a shipped build: `AVS_DIST=1` is set by the Swift launcher inside the
 * bundle, and no environment variable a customer can set will turn it off. Running from the repo
 * — which is what a developer does — the bypass works.
 */
export function bypassed() {
  return process.env.TOOLS_LICENSE_BYPASS === '1' && !isDist();
}

function client() {
  return new LicenseClient({ apiKey: clientApiKey(), baseUrl: storeUrl() });
}

/** The verdict, recomputed at most every 30s (each call verifies an RSA signature). */
export function status({ fresh = false } = {}) {
  if (bypassed()) {
    return { state: 'valid', reason: 'bypass', claims: null, key: null, daysLeft: null };
  }
  const now = Date.now();
  if (!fresh && cache && now - cache.at < STATUS_CACHE_MS) return cache.status;

  const stored = readStore();
  let next;
  if (stored.tamper) {
    // Fatal regardless of store config. The file-distribution build ships unconfigured, so without
    // this a "self-revoke on tamper" would do nothing on the exact build the owner hands out.
    // Cleared only by re-activation or sign-out (both rewrite the whole file).
    next = { state: 'locked', reason: 'tamper', claims: null, key: stored.key || null, daysLeft: null };
  } else if (!configured()) {
    // No store baked in and none in the environment: this build was never wired to a shop. Let it
    // run rather than brick a developer checkout — a released build always has both.
    next = { state: 'valid', reason: 'unconfigured', claims: null, key: null, daysLeft: null };
  } else {
    next = licenseState({ file: stored, device: deviceId(), publicKeyPem: publicKeyPem() });
  }
  cache = { at: now, status: next };
  return next;
}

/** Drop the memoised verdict; the next `status()` recomputes from disk. */
export function invalidate() {
  cache = null;
}

function announce(previous) {
  const next = status({ fresh: true });
  if (previous?.state !== next.state || previous?.reason !== next.reason) {
    licenseEvents.emit('change', next);
  }
  return next;
}

/** Everything the UI shows about the licence. Never returns the full key. */
export function publicStatus() {
  const s = status();
  const claims = s.claims || null;
  return {
    state: s.state,
    reason: s.reason || null,
    message: s.state === 'valid' ? null : reasonText(s.reason),
    runnable: isRunnable(s),
    daysLeft: s.daysLeft ?? null,
    key: maskKey(s.key),
    deviceId: configured() ? deviceId() : null,
    storeUrl: storeUrl() || null,
    plan: claims?.plan || null,
    features: claims?.features || [],
    expiresAt: claims?.expiresAt || null,
    graceUntil: claims?.graceUntil || null,
    lastOnlineAt: readStore().lastOnlineAt || null,
    productSlug: PRODUCT_SLUG,
    buyUrl: configured() ? `${webUrl()}/store/products/${PRODUCT_SLUG}` : null,
    devicesUrl: configured() ? `${webUrl()}/dashboard/devices` : null,
  };
}

/** Sign-out support: forget the licence and report the new (locked) verdict. */
export function forgetLicense() {
  const before = status();
  writeStore({});
  return announce(before);
}

/**
 * Lock this copy for good after it finds it has been tampered with.
 *
 * Writes a flag the verdict machine treats as fatal (see state.js), so the app refuses to run even
 * in an unconfigured build, and the flag survives the online heartbeat — `refreshNow` never clears
 * it. The only ways back are a full re-activation or a sign-out, both of which rewrite the whole
 * file. No file is deleted: a false positive costs a re-activation, never a customer's work.
 */
export function markTampered(reason = 'integrity') {
  const before = status();
  patchStore({
    tamper: true,
    tamperReason: String(reason),
    tamperedAt: new Date().toISOString(),
    token: null,
  });
  return announce(before);
}

/**
 * Register this machine against a licence key.
 *
 * The store's refusals are translated here rather than in the UI, because only this layer knows
 * which HTTP status means what — and "hết slot thiết bị" needs to point somewhere useful, not just
 * say no.
 */
export async function activate(key) {
  const licenseKey = String(key || '').trim().toUpperCase();
  if (!licenseKey) throw badRequest(m('Chưa nhập license key.'));
  if (!configured()) throw badRequest(m('Bản cài đặt này chưa được cấu hình cửa hàng.'));

  const before = status();
  const device = deviceId();
  let result;
  try {
    result = await client().activate(licenseKey, device, deviceInfo(appVersion()));
  } catch (e) {
    throw translate(e, licenseKey);
  }

  // A successful activation is the recovery door for a tamper lock: drop those fields so the
  // rewritten file no longer carries them (the rest — deviceFallbackId, etc. — is preserved).
  const rest = { ...readStore() };
  delete rest.tamper;
  delete rest.tamperReason;
  delete rest.tamperedAt;
  writeStore({
    ...rest,
    key: licenseKey,
    token: result.token,
    status: 'active',
    activatedAt: new Date().toISOString(),
    lastValidatedAt: new Date().toISOString(),
    lastOnlineAt: new Date().toISOString(),
  });
  const next = announce(before);
  logger.info(`license kích hoạt thành công (${maskKey(licenseKey)})`);
  return next;
}

/**
 * Heartbeat: ask the store whether the licence still stands, and renew the token before it runs
 * out. Being offline is not an answer — it leaves the verdict exactly as it was.
 */
export async function refreshNow() {
  if (!configured() || bypassed()) return status();
  const file = readStore();
  if (!file.key) return status();

  const before = status();
  const device = deviceId();
  let verdict;
  try {
    verdict = await client().validate(file.key, device);
  } catch (e) {
    if (e instanceof OfflineError) return before; // a laptop on a plane is not a pirate
    if (e?.status === 404) {
      patchStore({ status: 'revoked', token: null });
      return announce(before);
    }
    logger.warn(`license refresh lỗi: ${e.message}`);
    return before;
  }

  const now = new Date().toISOString();
  if (verdict.status === 'revoked' || verdict.status === 'suspended') {
    patchStore({ status: verdict.status, token: null, lastOnlineAt: now, lastValidatedAt: now });
    logger.warn(`license ${verdict.status} — app sẽ khoá lại`);
    return announce(before);
  }

  patchStore({ status: 'active', lastOnlineAt: now, lastValidatedAt: now });

  // Renew while there is still slack. Waiting for the token to expire would mean the one moment
  // the app needs the network is the moment the customer notices it is broken.
  const claims = before.claims;
  const needsToken =
    !file.token || !claims || (claims.exp * 1000 - Date.now() < RENEW_TOKEN_BEFORE_MS);
  if (needsToken) {
    try {
      const result = await client().activate(file.key, device, deviceInfo(appVersion()));
      patchStore({ token: result.token });
    } catch (e) {
      if (!(e instanceof OfflineError)) logger.warn(`không làm mới được license token: ${e.message}`);
    }
  }

  return announce(before);
}

/** Refresh now, then every six hours. Cheap: one small request per machine per cycle. */
export function startLicenseLoop() {
  if (timer || !configured() || bypassed()) return;
  void refreshNow().catch(() => undefined);
  timer = setInterval(() => void refreshNow().catch(() => undefined), REFRESH_INTERVAL_MS);
  timer.unref?.();
}

let version = null;
/** Set once at boot so device info and update checks report the running version. */
export function setAppVersion(v) {
  version = v;
}
export function appVersion() {
  return version;
}

function badRequest(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

function translate(e, licenseKey) {
  if (e instanceof OfflineError) {
    return withStatus(503, m('Không kết nối được tới cửa hàng. Kiểm tra mạng rồi thử lại.'));
  }
  if (e?.status === 404) {
    return withStatus(404, tp`Không tìm thấy license key ${maskKey(licenseKey)}. Kiểm tra lại key trong email.`);
  }
  if (e?.status === 403 && /device limit/i.test(e.message || '')) {
    return withStatus(
      403,
      tp`Hết slot thiết bị cho license này. Gỡ bớt một máy tại ${webUrl()}/dashboard/devices rồi kích hoạt lại.`,
    );
  }
  if (e?.status === 403) {
    return withStatus(403, tp`License không dùng được: ${e.message}`);
  }
  if (e?.status === 429) {
    return withStatus(429, m('Bạn thử quá nhiều lần. Đợi một phút rồi kích hoạt lại.'));
  }
  return withStatus(502, tp`Cửa hàng trả lỗi: ${e.message}`);
}

function withStatus(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}
