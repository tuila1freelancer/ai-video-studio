// The licence file on disk: `<DATA_DIR>/license.json`.
//
// Written atomically (temp file + rename) because the alternative is a truncated file after a
// crash or a pulled power cable, and a truncated licence file reads as "no licence" — the app
// would lock a paying customer out of their own machine over a failed write.
//
// Mode 0600: the token inside is a bearer credential for this device.
import { existsSync, chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from '../config/paths.js';

export function licenseFilePath() {
  return join(DIRS.data, 'license.json');
}

/** Everything known about the licence, or `{}` when there is none. */
export function readStore() {
  const path = licenseFilePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt file is not a licence. Say nothing louder than that here — the caller shows the
    // activation screen, and re-activating rewrites it.
    return {};
  }
}

export function writeStore(next) {
  const path = licenseFilePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best effort on odd filesystems */ }
  return next;
}

/** Merge a patch into the stored licence and persist it. */
export function patchStore(patch) {
  return writeStore({ ...readStore(), ...patch });
}

/** Forget the licence entirely (used by tests and by a deliberate sign-out). */
export function clearStore() {
  const path = licenseFilePath();
  if (existsSync(path)) unlinkSync(path);
}

/** `TOOLS-XXXX-…-1234` → `TOOLS-••••-••••-••••-1234`, for anything the UI displays. */
export function maskKey(key) {
  if (!key) return null;
  const parts = String(key).split('-');
  if (parts.length < 3) return `${String(key).slice(0, 4)}••••`;
  return [parts[0], ...parts.slice(1, -1).map(() => '••••'), parts.at(-1)].join('-');
}

// ---------------------------------------------------------------------------
// The signed-in account: `<DATA_DIR>/session.json`, same atomicity and 0600
// as the licence file. Kept separate on purpose — signing out must be able to
// destroy the session without touching a licence mid-write, and vice versa.
// ---------------------------------------------------------------------------

export function sessionFilePath() {
  return join(DIRS.data, 'session.json');
}

/** The stored session (user + JWT pair), or `{}` when nobody is signed in. */
export function readSession() {
  const path = sessionFilePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSession(next) {
  const path = sessionFilePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best effort on odd filesystems */ }
  return next;
}

export function clearSession() {
  const path = sessionFilePath();
  if (existsSync(path)) unlinkSync(path);
}
