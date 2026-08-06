// Where this build talks to, and which key it trusts.
//
// `scripts/release.mjs` rewrites the BAKED block below at release time: it fetches the store's
// public key from the production URL and writes it in, together with the store origin and the
// client API key. A distributed build therefore carries its trust anchor inside itself and never
// asks the network who to trust.
//
// Running from the repo (development) there is nothing baked, so the three values come from the
// environment instead. That fallback is deliberately unavailable to a distributed build: see
// `isDist()` — a customer must not be able to repoint their copy at a store they control.

// --- BEGIN BAKED CONFIG (rewritten by scripts/release.mjs — do not edit by hand) ---
const BAKED = {
  storeUrl: '',
  clientApiKey: '',
  publicKeyPem: '',
};
// --- END BAKED CONFIG ---

/** True inside a shipped .app bundle. Set by the Swift launcher, never by the user's shell. */
export function isDist() {
  return process.env.AVS_DIST === '1';
}

export function storeUrl() {
  if (BAKED.storeUrl) return BAKED.storeUrl;
  return isDist() ? '' : (process.env.AVS_STORE_URL || '');
}

export function clientApiKey() {
  if (BAKED.clientApiKey) return BAKED.clientApiKey;
  return isDist() ? '' : (process.env.AVS_STORE_API_KEY || '');
}

/**
 * The public key licence tokens are verified against.
 *
 * A shipped build only ever uses the baked key. Development may leave it empty and let
 * `fetchPublicKey` cache one from the store — convenient locally, and exactly the
 * trust-on-first-use hole that must not exist on a customer's machine.
 */
export function publicKeyPem() {
  if (BAKED.publicKeyPem) return BAKED.publicKeyPem;
  return isDist() ? '' : (process.env.AVS_STORE_PUBLIC_KEY || '');
}

/** Is this build wired to a store at all? */
export function configured() {
  return Boolean(storeUrl() && clientApiKey());
}

/** The platform string this build reports to the store's version endpoints. */
export const PLATFORM = 'macos-arm64';

/** Which release channel this build follows. */
export const CHANNEL = process.env.AVS_UPDATE_CHANNEL || 'stable';
