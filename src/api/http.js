// The HTTP plumbing shared by every router: async handlers whose rejections reach the error
// middleware, and one JSON shape for whatever falls through.
import { logger } from '../util/log.js';
import { codeFor } from '../core/api-codes.js';

/**
 * Set by server.js when an uncaught error was logged and swallowed: the process is still
 * serving, but its in-memory state may no longer match the database. Shown by /health.
 */
export const processHealth = { degraded: null };

/**
 * Express 4 does not catch a rejected async handler: the request hangs until the client gives
 * up. Wrapped, it becomes a JSON error like any other.
 * @template {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown} F
 * @param {F} fn
 */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Final handler for the API: JSON, never an HTML page with a stack trace. A body-parser limit,
 * a malformed JSON body and an uncaught throw all land here.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status || err?.statusCode) ? (err.status || err.statusCode) : 500;
  if (status >= 500) logger.error(`${req.method} ${req.originalUrl}: ${err?.stack || err?.message || err}`);
  const error = err?.expose || status < 500 ? (err?.message || 'request failed') : 'internal error';
  res.status(status).json({ code: err?.code || codeFor(error, status), error });
}
