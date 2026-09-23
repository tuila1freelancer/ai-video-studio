// Make a retried POST safe to send twice.
//
// Only the routes that spend something or create something are covered — the rest are cheap to
// repeat — and only when the caller opts in with an Idempotency-Key. The first reply is stored and
// replayed verbatim; reusing one key on a different route is a caller bug, and says so.
import { getIdempotentReply, saveIdempotentReply } from '../../db/index.js';
import { m } from '../../i18n/t.js';

/** POSTs where a double send costs money, a duplicate video or a duplicate upload. */
const COVERED = [
  /^\/projects$/,
  /^\/batch$/,
  /^\/projects\/[^/]+\/(start|resume|render|restart|publish|export)$/,
  /^\/calendar(\/plan)?$/,
  /^\/topics\/[^/]+\/(accept|schedule)$/,
];

/** @type {import('express').RequestHandler} */
export function idempotency(req, res, next) {
  const key = String(req.headers['idempotency-key'] || '').trim().slice(0, 200);
  if (!key || req.method !== 'POST' || !COVERED.some((re) => re.test(req.path))) return next();
  const route = `${req.method} ${req.path}`;
  const seen = getIdempotentReply(key);
  if (seen) {
    if (seen.route !== route) {
      return res.status(409).json({ code: 'idempotency_key_reused', error: 'idempotency_key_reused', message: m('Idempotency-Key này đã dùng cho một yêu cầu khác.') });
    }
    res.set('Idempotent-Replay', 'true');
    return res.status(seen.status).json(JSON.parse(seen.body));
  }
  // Wrapping res.json here — after the egress translator patched it — stores the reply BEFORE it is
  // translated, so a replay is answered in the retry's own language rather than the first one's.
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) {
      try { saveIdempotentReply({ key, route, status: res.statusCode, body: JSON.stringify(body) }); }
      catch { /* a failed record must never fail the request it describes */ }
    }
    return json(body);
  };
  return next();
}
