// The one integrity check the running server can honestly make about itself.
//
// The bytecode in app.jsc is verified by loader.cjs (AES-256-GCM auth tag + SHA-256), which is the
// only place that holds the decryption key — the server cannot re-verify the encrypted blob. What
// it CAN check for free is that the protection was never stripped: a real release always ships
// app.jsc.json with `encrypted: true` (the release audit enforces it), so a dist found running with
// `encrypted: false` — or repackaged around unencrypted bytecode — has been got at.
//
// False-positive-free by construction: it only fires in a dist build, only on a meta file it can
// actually read, and only when that file explicitly says the protection is off. Anything uncertain
// returns null — the app never accuses a customer on a guess.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDist } from './config.js';

/** @returns {string|null} a tamper reason to lock on, or null when nothing is provably wrong. */
export function distIntegrityProblem() {
  if (!isDist()) return null; // dev runs from source; there is no app.jsc to check
  // A release launches `node <flags> loader.cjs`, so argv[1] is the loader and the payload — with
  // app.jsc.json — sits beside it.
  const here = dirname(process.argv[1] || '');
  const metaPath = join(here, 'app.jsc.json');
  if (!existsSync(metaPath)) return null; // unknown layout — never accuse on a guess
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (meta.encrypted !== true) return 'unencrypted-bytecode';
  } catch {
    return null; // an unreadable meta file is not proof of tampering
  }
  return null;
}
