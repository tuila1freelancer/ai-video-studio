// Minting a token from the app's own window — and from nowhere else.
//
// P45 guarantee 2 says a token is minted at the machine, never over HTTP, for a good reason: a token
// is the key to the whole API, so handing one out must not be something the API can be talked into.
// That reason survives here intact, narrowed to the one case the CLI cannot serve — a customer who
// installed the app and has no repository, no terminal and no `npm run token`.
//
// Three locks, all three required: the request came from this machine, it came from the app's own
// window (the session the launcher handed it), and this is not a server deployment — `AVS_MODE=server`
// refuses outright and keeps the CLI. So an agent holding `admin` cannot mint itself a successor that
// outlives its own revocation: it is not the window, and on a server there is no window at all.
//
// Deliberately absent from `api/spec/operations.js`: that document is the agent-facing surface, and
// a route an agent is always refused does not belong in it.
import * as DB from '../../db/index.js';
import { isServerMode } from '../../core/runtime-mode.js';
import { isLocalRequest } from '../../ops/ui-session.js';
import { authRequired } from '../middleware/auth.js';
import { apiError } from '../../core/api-codes.js';
import { m } from '../../i18n/t.js';

/** The app's own window, on this machine, in a copy that is not a server. */
function requireAppWindow(req) {
  if (isServerMode()) {
    throw apiError('token_minting_disabled', m('bản máy chủ cấp token bằng npm run token, không qua API'), 403);
  }
  if (!isLocalRequest(req)) throw apiError('forbidden', m('forbidden'), 403);
  // With agent access on, the window proves itself with the session the launcher gave it; with it
  // off nothing on loopback is authenticated at all, and loopback is the only claim there is.
  if (authRequired() && !String(req.token?.id || '').startsWith('sys')) {
    throw apiError('forbidden', m('chỉ cửa sổ ứng dụng mới cấp được token'), 403);
  }
}

/** @param {import('express').Router} r */
export function mount(r) {
  r.get('/tokens', (req, res) => {
    requireAppWindow(req);
    res.json({ tokens: DB.listApiTokens({ includeSystem: false }), scopes: DB.SCOPES });
  });

  // The reply carries the secret. That is the only moment it exists outside the holder: it is never
  // logged and never recoverable, so the interface shows it once and says so.
  r.post('/tokens', (req, res) => {
    requireAppWindow(req);
    const name = String(req.body?.name || '').trim().slice(0, 80) || 'agent';
    const asked = Array.isArray(req.body?.scopes) && req.body.scopes.length ? req.body.scopes : ['read', 'produce'];
    const bad = asked.filter((s) => !DB.SCOPES.includes(s));
    if (bad.length) throw apiError('bad_request', m('quyền không hợp lệ'), 400);
    const channels = Array.isArray(req.body?.channelIds) ? req.body.channelIds.filter(Boolean) : [];
    res.json({ token: DB.createApiToken({ name, scopes: asked, channelIds: channels.length ? channels : null }) });
  });

  r.delete('/tokens/:id', (req, res) => {
    requireAppWindow(req);
    // The window's own session is not in the list and is not revocable through it.
    if (String(req.params.id).startsWith('sys')) throw apiError('forbidden', m('forbidden'), 403);
    res.json({ ok: DB.revokeApiToken(req.params.id) > 0 });
  });
}
