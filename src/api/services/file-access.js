// Path allowlist for internal media serving (P15). A served path must sit inside data/,
// the read-only reference app bundle, or a registered channel root — never anywhere else.
import { resolve, sep } from 'node:path';
import { DIRS } from '../../config/paths.js';
import * as DB from '../../db/index.js';

/**
 * @param {string} p an already-resolved absolute path
 * @returns {boolean} true if p is inside an allowed root
 */
export function inAllowedRoots(p) {
  const roots = [resolve(DIRS.data), '/Applications/AI VIDEO Tool.app',
    ...DB.listChannels().map((c) => resolve(c.root_dir))];
  return roots.some((root) => p === root || p.startsWith(root + sep));
}
