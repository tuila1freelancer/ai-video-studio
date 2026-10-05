// Hand a URL or a folder to the desktop: the system browser, and the file manager.
//
// Both used to be spelled `/usr/bin/open` inline, which is macOS and only macOS — on Windows the
// call simply did nothing, with no error to say so.
import { execFile } from 'node:child_process';

/**
 * The command that opens a URL on this platform.
 *
 * Windows goes through `cmd /c start` because there is no `open`; the empty pair of quotes is the
 * window TITLE that `start` takes as its first quoted argument — without it a quoted URL becomes
 * the title and nothing opens.
 *
 * @param {string} url @param {NodeJS.Platform} [platform]
 * @returns {{cmd: string, args: string[]}}
 */
export function openCommand(url, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { cmd: '/usr/bin/open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/**
 * Open a URL, calling back with an error if the platform's opener could not run.
 * @param {string} url @param {(err: Error|null) => void} [done]
 */
export function openExternal(url, done = () => {}) {
  const { cmd, args } = openCommand(url);
  execFile(cmd, args, (error) => done(error || null));
}

/**
 * The command that shows a folder — or a file inside its folder — in the desktop's file manager.
 *
 * Windows: `explorer` exits with status 1 even when it succeeded, so its result is never read as a
 * failure; `/select,<path>` is one argument with no space after the comma, which is the only spelling
 * explorer understands.
 *
 * @param {string} target @param {{reveal?: boolean, platform?: NodeJS.Platform}} [opts]
 * @returns {{cmd: string, args: string[], ignoreExit: boolean}}
 */
export function revealCommand(target, { reveal = false, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return { cmd: 'explorer', args: reveal ? [`/select,${target}`] : [target], ignoreExit: true };
  }
  if (platform === 'darwin') return { cmd: 'open', args: reveal ? ['-R', target] : [target], ignoreExit: false };
  return { cmd: 'xdg-open', args: [target], ignoreExit: false };
}

/** Show a folder (or reveal a file) in the file manager. Best-effort: a desktop may not be there. */
export function revealInFileManager(target, { reveal = false } = {}) {
  const { cmd, args } = revealCommand(target, { reveal });
  execFile(cmd, args, () => {});
}
