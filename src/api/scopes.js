// What each route asks of a token. Data, not code sprinkled over 178 handlers: a route added
// tomorrow is covered by a rule, not by memory.
//
// Fail-closed by construction: anything that does not match a rule still needs `produce` to write,
// and the four rules that matter (open, admin, publish, everything else) are ordered, so a path can
// only ever be granted by the FIRST rule that claims it.

/** Reachable without a token: the launcher's poll, and nothing else. */
const OPEN = /^\/health$/;

/**
 * Writes that reconfigure the installation rather than produce a video: provider keys, channels,
 * the queue's own switches. An agent that only makes videos must not hold these.
 */
const ADMIN_WRITE = [
  /^\/(settings|channels|ops|tokens)(\/|$)/,
  /^\/(assistant\/settings|platforms|llm|tts\/server)(\/|$)/,
  /^\/(styles|presets|logo-presets|subtitle-presets|export\/presets|hyperframe)(\/|$)/,
  /^\/brandgen\/providers(\/|$)/,
  // Connecting an account is not publishing to it.
  /^\/publish\/(facebook\/(connect|disconnect)|youtube\/auth-url)$/,
];

/** Anything that puts a video in front of an audience. `/projects/:id/publish` ends the same way. */
const PUBLISH_WRITE = [/^\/publish(\/|$)/, /\/publish$/];

/**
 * The scope a request needs, or null when the route is open.
 * @param {string} method @param {string} path path under /api, e.g. '/projects/abc/start'
 * @returns {'read'|'produce'|'publish'|'admin'|null}
 */
export function requiredScope(method, path) {
  const p = String(path || '');
  if (OPEN.test(p)) return null;
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (ADMIN_WRITE.some((re) => re.test(p))) return 'admin';
  if (PUBLISH_WRITE.some((re) => re.test(p))) return 'publish';
  return 'produce';
}
