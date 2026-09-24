// Sign in with the store account; the licence follows automatically.
//
// The flow is the loopback bridge the store exposes for desktop apps: start a
// listener on 127.0.0.1, open the system browser at the store's authorize
// endpoint, receive a one-time code on the listener, trade it for a JWT pair.
// With the session in hand the customer's licences are listed and the one for
// this product is activated — nobody ever types a licence key.
//
// Signing out forgets both the session and the licence: holding a licence on
// this machine is something the signed-in account did, and it leaves with it.
import { createServer } from 'node:http';
import { openExternal } from '../util/open-external.js';
import { logger } from '../util/log.js';
import { PRODUCT_SLUG, configured, isDist, storeUrl, webUrl } from './config.js';
import { activate, forgetLicense, status } from './index.js';
import {
  OfflineError,
  StoreError,
  desktopAuthorizeUrl,
  desktopDevLogin,
  exchangeDesktopCode,
  listMyLicenses,
  randomState,
  refreshDesktopSession,
} from './sdk.js';
import { clearSession, readSession, writeSession } from './store.js';

import { m, tp } from '../i18n/t.js';
/** How long the browser tab may sit unfinished before the listener gives up. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Rotate the pair once the access token is past this age (its TTL is 15 min). */
const SESSION_STALE_MS = 10 * 60 * 1000;

let loginInFlight = null;

/** The signed-in account for the UI, or null. Never exposes the tokens. */
export function sessionAccount() {
  const session = readSession();
  return session.user ? { email: session.user.email, name: session.user.name ?? null } : null;
}

/**
 * Which of the customer's licences this app should activate.
 *
 * Pure and exported for tests. Rules: only this product; `active` beats
 * anything else; among equals, the one expiring last (lifetime = null sorts
 * first of all) wins.
 */
export function chooseLicense(licenses, slug = PRODUCT_SLUG) {
  const mine = (Array.isArray(licenses) ? licenses : []).filter(
    (l) => l?.product?.slug === slug && l?.key,
  );
  if (mine.length === 0) return null;
  const rank = (l) => (l.status === 'active' ? 0 : 1);
  const expiry = (l) => (l.expiresAt ? new Date(l.expiresAt).getTime() : Number.POSITIVE_INFINITY);
  mine.sort((a, b) => rank(a) - rank(b) || expiry(b) - expiry(a));
  return mine[0];
}

/**
 * Sign in and activate. Resolves to `{ status, account, licenseFound }` —
 * `licenseFound: false` means the account is real but owns no licence for
 * this product, and the UI should point at the buy page rather than an error.
 */
export function signIn() {
  if (!configured()) {
    return Promise.reject(withStatus(400, m('Bản cài đặt này chưa được cấu hình cửa hàng.')));
  }
  // A second click while the browser tab is open joins the first attempt
  // instead of racing it for the loopback port.
  if (!loginInFlight) {
    loginInFlight = runSignIn().finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

async function runSignIn() {
  const session = await obtainSession();
  writeSession({
    user: session.user,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    obtainedAt: new Date().toISOString(),
  });
  logger.info(`đăng nhập cửa hàng: ${session.user.email}`);
  const licenseFound = await adoptLicense(session.accessToken);
  return { status: status({ fresh: true }), account: sessionAccount(), licenseFound };
}

/** List the account's licences and activate the right one, if there is one. */
async function adoptLicense(accessToken) {
  let licenses;
  try {
    licenses = await listMyLicenses(storeUrl(), accessToken);
  } catch (e) {
    throw translateAuthError(e);
  }
  const license = chooseLicense(licenses);
  if (!license) return false;
  await activate(license.key); // translates store refusals itself
  return true;
}

/**
 * Sign-in again without a browser when the licence needs re-adopting (a new
 * device, an admin reset). Uses the stored session; throws 401-shaped when
 * the session is gone and a fresh sign-in is needed.
 */
export async function adoptWithStoredSession() {
  const accessToken = await freshAccessToken();
  if (!accessToken) {
    throw withStatus(401, m('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.'));
  }
  return adoptLicense(accessToken);
}

/** Forget the session and the licence; the app locks on the next verdict. */
export function signOut() {
  clearSession();
  const next = forgetLicense();
  logger.info('đã đăng xuất và gỡ license khỏi máy này');
  return next;
}

/**
 * A usable access token from the stored session, rotating the pair when it is
 * older than SESSION_STALE_MS. Null when nobody is signed in; a session the
 * store refuses (revoked account, ancient refresh token) is cleared so the UI
 * asks for a fresh sign-in instead of failing forever.
 */
export async function freshAccessToken() {
  const session = readSession();
  if (!session.accessToken || !session.refreshToken) return null;
  const age = Date.now() - new Date(session.obtainedAt || 0).getTime();
  if (age < SESSION_STALE_MS) return session.accessToken;
  try {
    const rotated = await refreshDesktopSession(storeUrl(), session.refreshToken);
    writeSession({
      user: rotated.user,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      obtainedAt: new Date().toISOString(),
    });
    return rotated.accessToken;
  } catch (e) {
    if (e instanceof OfflineError) return session.accessToken; // stale beats none while offline
    clearSession();
    return null;
  }
}

// ---------------------------------------------------------------------------
// The loopback dance
// ---------------------------------------------------------------------------

async function obtainSession() {
  // Development shortcut: the store's dev-login mirrors Google without
  // credentials. Dead in a shipped build — isDist() wins over any env var.
  const devEmail = !isDist() && process.env.TOOLS_DEV_LOGIN_EMAIL;
  if (devEmail) {
    logger.warn(`đăng nhập dev (${devEmail}) — chỉ tồn tại khi chạy từ repo`);
    return desktopDevLogin(storeUrl(), devEmail);
  }
  const code = await codeFromBrowser();
  return exchangeDesktopCode(storeUrl(), code);
}

/** Run the listener + browser round-trip; resolve with the one-time code. */
function codeFromBrowser() {
  return new Promise((resolve, reject) => {
    const state = randomState();
    let settled = false;

    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      const ok = !err && code && gotState === state;
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(callbackPage(ok));
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (ok) resolve(code);
      else if (err) reject(withStatus(401, m('Đăng nhập Google không thành công. Thử lại.')));
      else reject(withStatus(400, m('Phản hồi đăng nhập không hợp lệ.')));
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(withStatus(408, m('Hết thời gian chờ đăng nhập. Bấm "Đăng nhập" để thử lại.')));
    }, LOGIN_TIMEOUT_MS);
    timer.unref?.();

    server.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(withStatus(500, tp`Không mở được cổng đăng nhập trên máy: ${e.message}`));
    });

    // Port 0: the OS picks a free port, so two apps signing in at once never
    // collide. The store pins its redirect to 127.0.0.1 + this port.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const authorizeUrl = desktopAuthorizeUrl(storeUrl(), { state, port });
      openExternal(authorizeUrl, (error) => {
        if (!error || settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        reject(withStatus(500, m('Không mở được trình duyệt để đăng nhập.')));
      });
    });
  });
}

/** What the browser tab shows once its part is done. */
function callbackPage(ok) {
  const title = ok ? m('Đăng nhập thành công') : m('Đăng nhập không thành công');
  const body = ok
    ? m('Quay lại AI Video Studio để tiếp tục — có thể đóng tab này.')
    : m('Quay lại AI Video Studio và bấm "Đăng nhập" để thử lại.');
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#070715;color:#f2f4ff;font-family:system-ui">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#9ca3d9">${body}</p></div>`;
}

function translateAuthError(e) {
  if (e instanceof OfflineError) {
    return withStatus(503, m('Không kết nối được tới cửa hàng. Kiểm tra mạng rồi thử lại.'));
  }
  if (e instanceof StoreError && e.status === 401) {
    clearSession();
    return withStatus(401, m('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.'));
  }
  return withStatus(502, tp`Cửa hàng trả lỗi: ${e.message}`);
}

function withStatus(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

/** Where "Mua license" points — the product page for THIS app. */
export function buyUrl() {
  return `${webUrl()}/products/${PRODUCT_SLUG}`;
}
