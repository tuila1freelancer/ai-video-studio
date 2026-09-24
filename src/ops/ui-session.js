// How the app's own window gets in once tokens are enforced.
//
// Turning on agent access means the API asks every caller for a token — including the window the
// owner is looking at. It cannot be asked to paste one: it is the app. So the launcher mints a
// one-boot nonce, passes it in the environment (never on a command line, where `ps` would print it),
// and opens the window at `/?uikey=<nonce>`. That one request, from loopback only, trades the nonce
// for a session cookie and redirects to a clean URL.
//
// The honest ceiling: any process on this machine could read the environment of a process it owns.
// The boundary here is the machine, exactly as it is for the data directory sitting beside it.
import { createApiToken, listApiTokens, revokeApiToken } from '../db/index.js';
import { logger } from '../util/log.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** Minted once per boot and held in memory: the window may reload, and it needs the same answer. */
let session = null;

/** The nonce this boot expects, or '' when nothing set one (a dev tree, a bare `npm start`). */
export const uiKey = (env = process.env) => String(env.AVS_UI_KEY || '');

/** Did this request come from the machine itself? */
export function isLocalRequest(req) {
  return LOOPBACK.has(String(req?.ip || req?.socket?.remoteAddress || '').trim());
}

/**
 * Should this request be handed a session cookie?
 * @param {{query?: object, ip?: string, socket?: object}} req
 */
export function wantsUiSession(req, env = process.env) {
  const key = uiKey(env);
  if (!key) return false;
  const asked = String(req?.query?.uikey || '');
  // Same length and same bytes; a mismatch is simply "no", never a hint about how close it was.
  return asked.length === key.length && asked === key && isLocalRequest(req);
}

/**
 * The app window's token. Minted on first use, kept for the life of the process, and the ONLY
 * token that is not something a person created — so it is never offered in the revoke list.
 */
export function uiSessionToken() {
  if (session) return session;
  // A previous process's window token can never be handed out again; it goes rather than linger.
  for (const old of listApiTokens()) {
    if (old.id.startsWith('sys')) revokeApiToken(old.id);
  }
  const made = createApiToken({ name: 'app window', scopes: ['admin'], system: true });
  session = made.token;
  logger.info('app window: phiên nội bộ đã sẵn sàng');
  return session;
}

/** Test seam: forget the in-memory session so a fresh one is minted. */
export function resetUiSession() { session = null; }
