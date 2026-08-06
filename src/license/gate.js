// The edge: no licence, no API.
//
// Mounted as the FIRST middleware on the `/api` router, so it stands in front of every route
// rather than in front of the ones somebody remembered to decorate. Two things stay open:
//
//   /health    — the Swift launcher polls it to decide the server is up. Gate it and the window
//                never appears, so the customer cannot even reach the screen that asks for a key.
//   /license/* — the way out of the locked state. Gating it would be a locked door with the key
//                on the inside.
//
// This is a commercial mechanism, not copy protection. The customer owns the machine and the app
// is plain JavaScript on their disk; anyone determined can edit this file. The point is that using
// the product without paying takes a deliberate act, not an oversight — so no effort is spent on
// obfuscation, and all of it goes into the licensed path being pleasant.
import { isRunnable, reasonText } from './state.js';
import { status } from './index.js';

const ALLOWED = [/^\/health$/, /^\/license(\/|$)/];

export function licenseGate(req, res, next) {
  if (ALLOWED.some((re) => re.test(req.path))) return next();
  const current = status();
  if (isRunnable(current)) return next();
  return res.status(403).json({
    error: 'license_required',
    state: current.state,
    reason: current.reason || null,
    message: reasonText(current.reason),
  });
}
