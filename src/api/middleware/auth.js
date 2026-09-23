// The server lane's edge: no token, no API.
//
// Mounted next to the licence gate, and the division between them is deliberate — the licence
// decides whether this COPY may run, this decides WHO is asking. In desktop mode it is a no-op, so
// the shells and the browser UI keep talking to their own loopback server exactly as before.
import { countApiTokens, tokenHasScope, verifyApiToken } from '../../db/index.js';
import { isServerMode } from '../../core/runtime-mode.js';
import { agentEnabled } from '../../ops/agent-mode.js';
import { requiredScope } from '../scopes.js';
import { m, tp } from '../../i18n/t.js';

/**
 * `Authorization: Bearer <token>`, or the cookie the browser sends by itself.
 *
 * The cookie is not a second way in for an agent — it is the only way a BROWSER can authenticate a
 * subresource. A stylesheet, an <img src="/api/thumb…"> and a font face carry no headers, so in
 * server mode the interface would load and then show nothing. The access screen writes the same
 * token to the cookie; SameSite=Strict keeps another site from spending it.
 */
export function bearerOf(req) {
  const header = String(req.headers?.authorization || '');
  const m2 = /^Bearer\s+(\S+)$/i.exec(header);
  if (m2) return m2[1];
  const cookie = /(?:^|;\s*)avs_token=([^;]+)/.exec(String(req.headers?.cookie || ''));
  return cookie ? decodeURIComponent(cookie[1]) : null;
}

/**
 * Is a token required at all?
 *
 * Two ways in: the deployment was started as a server, or the owner turned agent access on in the
 * app. The second is what makes an installed copy safe to hand an agent — without it every process
 * on the machine is the owner, and nothing is revocable.
 */
export function authRequired() {
  return isServerMode() || agentEnabled();
}

/** @type {import('express').RequestHandler} */
export function apiAuth(req, res, next) {
  if (!authRequired()) {
    req.actor = 'ui'; // the desktop app has exactly one caller, and it is sitting at the machine
    return next();
  }
  const scope = requiredScope(req.method, req.path);
  if (scope === null) return next();
  const token = verifyApiToken(bearerOf(req));
  if (!token) {
    return res.status(401).json({
      code: 'token_required',
      error: 'token_required',
      message: m('Cần API token hợp lệ (Authorization: Bearer …) để gọi API ở chế độ server.'),
    });
  }
  if (!tokenHasScope(token, scope)) {
    return res.status(403).json({
      code: 'scope_denied',
      error: 'scope_denied',
      message: tp`Token này không có quyền ${scope}.`,
    });
  }
  req.token = token;
  req.actor = `token:${token.id}`;
  return next();
}

/**
 * Why the server lane must not start, or null.
 *
 * A server with no tokens answers 401 to everything, which looks like a broken deployment rather
 * than a locked one — and the temptation is then to turn authentication off. Refusing at boot says
 * the real thing: mint a token first.
 */
export function authRefusal() {
  if (!isServerMode()) return null;
  if (countApiTokens() > 0) return null;
  return 'AVS_MODE=server but no API token exists — mint one with `npm run token -- create --name <who> --scopes read,produce` before starting the server.';
}
