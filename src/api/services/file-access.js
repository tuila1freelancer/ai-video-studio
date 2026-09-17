// Path allowlist for internal media serving (P15). A served path must sit inside data/,
// the read-only reference app bundle, or a registered channel root — never anywhere else.
import { resolve, sep } from 'node:path';
import { DIRS } from '../../config/paths.js';
import * as DB from '../../db/index.js';

// Rebuilt only when a channel is written: this runs on every media request the UI makes.
let cache = { version: -1, roots: [] };
function allowedRoots() {
  const version = DB.channelsVersion();
  if (cache.version !== version) {
    cache = { version, roots: [resolve(DIRS.data), '/Applications/AI VIDEO Tool.app', ...DB.listChannels().map((c) => resolve(c.root_dir))] };
  }
  return cache.roots;
}

/**
 * @param {string} p an already-resolved absolute path
 * @returns {boolean} true if p is inside an allowed root
 */
export function inAllowedRoots(p) {
  return allowedRoots().some((root) => p === root || p.startsWith(root + sep));
}
