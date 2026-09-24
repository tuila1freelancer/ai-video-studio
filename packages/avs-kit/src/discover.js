// Finding the running app without being told where it is.
//
// An agent host is configured once and then runs for months. It cannot be configured with a URL,
// because the app binds port 0 and gets a different one on every launch — a baked-in `--url` would
// work until the owner restarts the app and then quietly stop. The app writes the URL it actually
// bound into `server.url` in its data directory at every boot, so the honest answer is to read it.
//
// The candidates below are the places that file can be, per platform. Pure: what to look at is one
// function, and reading is another, so the whole thing is testable from any operating system.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the app lived before it could tell anyone where it lives. Nothing else should need it. */
export const DEFAULT_URL = 'http://127.0.0.1:8123';

/**
 * Every place a running copy may have written its URL, in the order they are believed.
 * @param {NodeJS.Platform} [platform] @param {Record<string,string|undefined>} [env] @param {string} [home]
 */
export function urlFiles(platform = process.platform, env = process.env, home = homedir()) {
  const out = [];
  if (env.AVS_DATA_DIR) out.push(join(env.AVS_DATA_DIR, 'server.url'));
  if (platform === 'darwin') out.push(join(home, 'Library', 'Application Support', 'AI Video Studio', 'server.url'));
  if (platform === 'win32') {
    const roaming = env.APPDATA || join(home, 'AppData', 'Roaming');
    // Electron names this folder after the app, and which of the two names it uses depends on how
    // the build was packaged — so both are looked at rather than guessed at.
    out.push(join(roaming, 'ai-video-studio', 'data', 'server.url'));
    out.push(join(roaming, 'AI Video Studio', 'data', 'server.url'));
  }
  // The kit travelling inside a payload, or sitting in a repository: data/ is beside its root.
  out.push(fileURLToPath(new URL('../../../data/server.url', import.meta.url)));
  out.push(join(process.cwd(), 'data', 'server.url'));
  return out;
}

/**
 * The URL the app last bound, or the old fixed default when nothing on this machine says.
 *
 * An explicit AVS_DATA_DIR is obeyed outright — the operator said where. Otherwise the file
 * written MOST RECENTLY wins, not the first one found: a machine can hold an installed app and a
 * repository at once, both have written this file, and the one that wrote it last is the one that
 * is running. Reading a stale file is the difference between an agent working and an agent
 * reporting "fetch failed" at a port nothing has listened on for a week.
 */
export function discoverUrl(platform = process.platform, env = process.env, files = urlFiles(platform, env)) {
  const found = [];
  for (const file of files) {
    try {
      const text = readFileSync(file, 'utf8').trim();
      if (!/^https?:\/\/\S+$/.test(text)) continue;
      if (env.AVS_DATA_DIR && file === files[0]) return text;
      found.push({ url: text, at: statSync(file).mtimeMs });
    } catch { /* unreadable is the same as absent */ }
  }
  found.sort((a, b) => b.at - a.at);
  return found[0]?.url || DEFAULT_URL;
}
