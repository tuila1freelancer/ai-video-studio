// Which shape this process runs in: the desktop app on loopback, or a server an agent talks to.
//
// Everything the agent lane adds hangs off this one switch, and the default is the app that already
// exists — `desktop` binds loopback and asks for no token, so both shells, the browser UI and every
// test behave exactly as they did. Pure on purpose: a resolver with no I/O can be tested without
// booting anything, which is how the refusal below is proven rather than hoped for.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

/** @returns {'desktop'|'server'} */
export function mode(env = process.env) {
  return env.AVS_MODE === 'server' ? 'server' : 'desktop';
}

export function isServerMode(env = process.env) {
  return mode(env) === 'server';
}

/** The interface to bind. A container publishes on 0.0.0.0; the app never does. */
export function host(env = process.env) {
  return String(env.AVS_HOST || '').trim() || '127.0.0.1';
}

export function isLoopback(h) {
  return LOOPBACK.has(String(h || '').trim());
}

/**
 * Why this process must not start, or null when it may.
 *
 * The API answers to whoever reaches the port: the token decides WHO may call it,
 * never who is asking. Publishing that beyond loopback without the server lane's token check would
 * hand anyone on the network the user's projects and provider keys, so it is refused at boot —
 * loudly, and before the port is open, rather than discovered later.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function bootRefusal(env = process.env) {
  if (!isLoopback(host(env)) && !isServerMode(env)) {
    return `AVS_HOST=${host(env)} is not loopback, but AVS_MODE is 'desktop' — an unauthenticated API must not be published to a network. Set AVS_MODE=server (bearer tokens required) or bind 127.0.0.1.`;
  }
  return null;
}
