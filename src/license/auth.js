// Sign in with the store account; the licence follows automatically.
//
// The flow is RFC 8252 with PKCE: start a listener on 127.0.0.1, open the system
// browser at the store's own page, receive a one-time code on the listener,
// trade it for a link token. The store answers with the licences this account
// holds FOR THIS PRODUCT — which product that is comes from the client key baked
// into the build, never from a name typed in here — and the right one is
// activated. Nobody ever types a licence key.
//
// Signing out forgets the session, the licence, and the link at the store:
// holding a licence on this machine is something the signed-in account did, and
// it leaves with it.
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { logger } from '../util/log.js';
import { openExternal } from '../util/open-external.js';
import { clientApiKey, configured, PLATFORM, PRODUCT_SLUG, storeUrl, webUrl } from './config.js';
import { activate, forgetLicense, status } from './index.js';
import {
  clientKeyPrefix,
  desktopLinkUrl,
  desktopRevoke,
  desktopSession,
  exchangeDesktopCode,
  OfflineError,
  pkcePair,
  randomState,
  StoreError,
} from './sdk.js';
import { clearSession, readSession, writeSession } from './store.js';

import { m, tp } from '../i18n/t.js';
/** How long the browser tab may sit unfinished before the listener gives up. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

let loginInFlight = null;

/** The signed-in account for the UI, or null. Never exposes the tokens. */
export function sessionAccount() {
  const session = readSession();
  return session.user ? { email: session.user.email, name: session.user.name ?? null } : null;
}

/**
 * Which of the account's licences this app should activate.
 *
 * Pure and exported for tests. The list already contains only this product's
 * licences — the store narrowed it by the client key — so the only filtering
 * left is dropping the ones the store would refuse to activate. `active` beats
 * anything else, and among equals the one expiring last wins (a lifetime
 * licence, with no expiry, wins outright).
 */
export function chooseLicense(licenses) {
  // Revoked and suspended are the two the store refuses outright; an expired one is still
  // activated, because the token it returns is what carries the expiry and the grace window.
  const mine = (Array.isArray(licenses) ? licenses : []).filter(
    (l) => l?.key && l.status !== 'revoked' && l.status !== 'suspended',
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
  const { code, verifier } = await codeFromBrowser();
  let linked;
  try {
    linked = await exchangeDesktopCode(storeUrl(), clientApiKey(), { code, verifier });
  } catch (e) {
    throw translateAuthError(e);
  }
  writeSession({ user: linked.user, token: linked.token, obtainedAt: new Date().toISOString() });
  logger.info(`đăng nhập cửa hàng: ${linked.user?.email}`);
  const licenseFound = await adoptLicense(linked.licenses);
  return { status: status({ fresh: true }), account: sessionAccount(), licenseFound };
}

/** Activate the best of the licences the store just listed, if there is one. */
async function adoptLicense(licenses) {
  const license = chooseLicense(licenses);
  if (!license) return false;
  await activate(license.key); // translates store refusals itself
  return true;
}

/**
 * Re-adopt without a browser: a new device, an admin reset, a licence bought
 * after signing in. Uses the stored link; throws 401-shaped when it is gone and
 * a fresh sign-in is needed.
 */
export async function adoptWithStoredSession() {
  const { token } = readSession();
  if (!token) {
    throw withStatus(401, m('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.'));
  }
  let linked;
  try {
    linked = await desktopSession(storeUrl(), clientApiKey(), token);
  } catch (e) {
    throw translateAuthError(e);
  }
  // The account may have been renamed since; keep what the store says.
  writeSession({ ...readSession(), user: linked.user });
  return adoptLicense(linked.licenses);
}

/** Forget the session and the licence; the app locks on the next verdict. */
export function signOut() {
  const { token } = readSession();
  if (token) unlinkAtStore(token);
  clearSession();
  const next = forgetLicense();
  logger.info('đã đăng xuất và gỡ license khỏi máy này');
  return next;
}

/**
 * Tell the store this machine is signed out, without making the owner wait.
 *
 * A failure here is not worth showing: the session file is already gone, so the
 * app is signed out either way, and the link expires on its own.
 */
function unlinkAtStore(token) {
  desktopRevoke(storeUrl(), clientApiKey(), token).catch((e) => {
    logger.warn(`không thu hồi được liên kết ở cửa hàng: ${e.message}`);
  });
}

// ---------------------------------------------------------------------------
// The loopback dance
// ---------------------------------------------------------------------------

/**
 * Run the listener plus the browser round-trip; resolve with the code and the
 * verifier that proves this program asked for it.
 */
function codeFromBrowser() {
  return new Promise((resolve, reject) => {
    const state = randomState();
    const { verifier, challenge } = pkcePair();
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
      if (ok) resolve({ code, verifier });
      else if (err) reject(withStatus(401, m('Đăng nhập không thành công. Thử lại.')));
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
      const url = desktopLinkUrl(webUrl(), {
        client: clientKeyPrefix(clientApiKey()),
        state,
        challenge,
        port,
        label: machineName(),
        platform: PLATFORM,
      });
      openExternal(url, (error) => {
        if (!error || settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        reject(withStatus(500, m('Không mở được trình duyệt để đăng nhập.')));
      });
    });
  });
}

/** What the consent page shows beside the account, so the owner knows which machine. */
function machineName() {
  return String(hostname() || '').replace(/\.local$/, '') || null;
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
  return `${webUrl()}/store/products/${PRODUCT_SLUG}`;
}
