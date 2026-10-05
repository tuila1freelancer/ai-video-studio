// Bearer tokens for the server lane: who may call the API, with which powers, over which channels.
//
// The secret half is shown once, at creation, and never stored — only its SHA-256. A token that
// leaks out of the owner's notes cannot be recovered from this database, and a stolen database
// yields no working token. Verification compares digests with timingSafeEqual, so a wrong token
// takes the same time as a right one.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import db, { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

/** Every power a token can carry. `admin` covers settings and channel writes. */
export const SCOPES = ['read', 'produce', 'publish', 'admin'];

/** Rows are written at most this often per token — an auth check must not cost a write. */
const TOUCH_MS = 60_000;

const digest = (secret) => createHash('sha256').update(String(secret)).digest('hex');

const row = (r) => (r ? {
  id: r.id,
  name: r.name,
  scopes: safeJson(r.scopes, []),
  channelIds: r.channel_ids ? safeJson(r.channel_ids, null) : null,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
} : null);

/**
 * Mint a token. The returned `token` is the ONLY time the secret exists outside the holder.
 * @param {{name?: string, scopes?: string[], channelIds?: string[]|null}} input
 */
export function createApiToken({ name = 'agent', scopes = ['read'], channelIds = null, system = false } = {}) {
  const picked = [...new Set(scopes)].filter((s) => SCOPES.includes(s));
  if (!picked.length) throw new Error(`scopes must be a subset of ${SCOPES.join('|')}`);
  // The app window's own session is not something a person created, so it carries a different id
  // prefix and is filtered out of the list people revoke from.
  const id = newId(system ? 'sys' : 'tok');
  const secret = randomBytes(24).toString('base64url');
  stmt(`INSERT INTO api_tokens(id,name,hash,scopes,channel_ids,created_at)
        VALUES(@id,@name,@hash,@scopes,@channel_ids,@created_at)`).run({
    id,
    name: String(name).slice(0, 80),
    hash: digest(secret),
    scopes: JSON.stringify(picked),
    channel_ids: channelIds?.length ? JSON.stringify(channelIds) : null,
    created_at: Date.now(),
  });
  return { ...row(getApiTokenRow(id)), token: `avs_${id}_${secret}` };
}

function getApiTokenRow(id) {
  return stmt('SELECT * FROM api_tokens WHERE id=?').get(String(id));
}

/** The token behind a header value, or null. Never throws on a malformed string. */
export function verifyApiToken(raw) {
  const m = /^avs_([A-Za-z0-9]+)_([A-Za-z0-9_-]+)$/.exec(String(raw || '').trim());
  if (!m) return null;
  const found = getApiTokenRow(m[1]);
  if (!found || found.revoked_at) return null;
  const a = Buffer.from(digest(m[2]), 'hex');
  const b = Buffer.from(found.hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const now = Date.now();
  if (!found.last_used_at || now - found.last_used_at > TOUCH_MS) {
    stmt('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(now, found.id);
  }
  return row(found);
}

export function listApiTokens({ includeRevoked = false, includeSystem = true } = {}) {
  const sql = `SELECT * FROM api_tokens ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'} ORDER BY created_at DESC`;
  const rows = stmt(sql).all().map(row);
  return includeSystem ? rows : rows.filter((t) => !t.id.startsWith('sys'));
}

export function revokeApiToken(id) {
  return stmt('UPDATE api_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(Date.now(), String(id)).changes;
}

/** Whether the server lane has anyone to answer to at all — a boot-time refusal reads this. */
export function countApiTokens() {
  return db.prepare('SELECT COUNT(*) n FROM api_tokens WHERE revoked_at IS NULL').get().n;
}

/** Does this token carry that power? `admin` implies every other scope. */
export function tokenHasScope(token, scope) {
  const has = token?.scopes || [];
  return has.includes('admin') || has.includes(scope);
}

/** Does this token reach that channel? A token with no channel list reaches every channel. */
export function tokenHasChannel(token, channelId) {
  if (!token?.channelIds?.length) return true;
  return !channelId || token.channelIds.includes(channelId);
}
