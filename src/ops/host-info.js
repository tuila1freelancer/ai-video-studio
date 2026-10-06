// Where this copy of the app actually lives, so the interface can print a command that runs.
//
// The Agent panel has to show a line the user can paste into their agent — and that line is an
// absolute path to a Node binary and an absolute path to the kit, both different on every machine
// and on every layout (repo, macOS bundle, Windows bundle). The interface cannot guess any of it:
// it is a browser page and the only thing that knows is the process serving it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DATA_DIR } from '../config/paths.js';
import { uiKey } from './ui-session.js';

const first = (...candidates) => candidates.find((p) => p && existsSync(p)) || null;

/**
 * A Node the user can run the kit with.
 *
 * Bundled runtimes come first: `Resources/node/bin/node` beside the macOS payload, `node-win` beside
 * the Windows one. `process.execPath` is the honest fallback everywhere else — except under Electron,
 * where this process IS the app binary and only behaves as Node because ELECTRON_RUN_AS_NODE is set.
 */
export function nodeExecutable(platform = process.platform) {
  const win = platform === 'win32';
  return first(
    join(ROOT, '..', 'node', 'bin', 'node'),
    join(ROOT, '..', 'node-win', 'node.exe'),
    join(ROOT, 'vendor', 'node', 'bin', win ? 'node.exe' : 'node'),
    join(ROOT, 'vendor', 'node-win', 'node.exe'),
  ) || (process.versions.electron ? null : process.execPath);
}

/** The Agent Kit shipped beside the payload, or null in a build that carries none. */
export function kitPaths() {
  const dir = join(ROOT, 'packages', 'avs-kit');
  const mcp = join(dir, 'bin', 'avs-mcp.mjs');
  return existsSync(mcp) ? { dir, mcp, cli: join(dir, 'bin', 'avs.mjs') } : null;
}

/** What the interface needs to explain this installation to its user. Paths, never secrets. */
export function hostInfo() {
  return {
    platform: process.platform,
    dist: process.env.AVS_DIST === '1',
    root: ROOT,
    dataDir: DATA_DIR,
    node: nodeExecutable(),
    kit: kitPaths(),
    // Started by a shell, so a window session exists: turning agent access on will not lock the
    // user out. Started by hand, and the page asking this is a browser tab that will need a token.
    launcher: Boolean(uiKey()),
  };
}
