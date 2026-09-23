// Replayed replies for retried requests.
//
// A network timeout tells the caller nothing about whether the work happened. Without this, an
// agent's retry of "create the video" makes a second video and a second bill; with it, the retry
// gets the first reply back, byte for byte.
import { stmt } from '../connection.js';

/** How long a key is honoured. Long enough for any retry, short enough not to grow forever. */
const TTL_MS = 24 * 60 * 60 * 1000;

export function getIdempotentReply(key) {
  const row = stmt('SELECT * FROM idempotency WHERE key=?').get(String(key));
  if (!row) return null;
  if (Date.now() - row.created_at > TTL_MS) {
    stmt('DELETE FROM idempotency WHERE key=?').run(row.key);
    return null;
  }
  return row;
}

export function saveIdempotentReply({ key, route, status, body }) {
  stmt(`INSERT INTO idempotency(key,route,status,body,created_at) VALUES(?,?,?,?,?)
        ON CONFLICT(key) DO NOTHING`).run(String(key), route, status, body, Date.now());
}

/** Housekeeping, called by the same sweep that clears tmp files. */
export function pruneIdempotency() {
  return stmt('DELETE FROM idempotency WHERE created_at < ?').run(Date.now() - TTL_MS).changes;
}
