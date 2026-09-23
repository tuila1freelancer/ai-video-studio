import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCommand, revealCommand } from '../src/util/open-external.js';

test('a URL opens on every platform the app ships to', () => {
  assert.deepEqual(openCommand('https://store.test/auth', 'darwin'), { cmd: '/usr/bin/open', args: ['https://store.test/auth'] });
  // The empty string is the window TITLE start() takes first: without it the URL becomes the title
  // and nothing opens — the whole reason Windows sign-in did nothing.
  assert.deepEqual(openCommand('https://store.test/auth', 'win32'), { cmd: 'cmd', args: ['/c', 'start', '', 'https://store.test/auth'] });
  assert.deepEqual(openCommand('https://store.test/auth', 'linux'), { cmd: 'xdg-open', args: ['https://store.test/auth'] });
});

test('a folder — or a file inside it — shows in the right file manager', () => {
  assert.deepEqual(revealCommand('/tmp/out', { platform: 'darwin' }), { cmd: 'open', args: ['/tmp/out'], ignoreExit: false });
  assert.deepEqual(revealCommand('/tmp/out/final.mp4', { reveal: true, platform: 'darwin' }).args, ['-R', '/tmp/out/final.mp4']);
  assert.deepEqual(revealCommand('C:\\out', { platform: 'win32' }), { cmd: 'explorer', args: ['C:\\out'], ignoreExit: true });
  assert.deepEqual(revealCommand('C:\\out\\final.mp4', { reveal: true, platform: 'win32' }).args, ['/select,C:\\out\\final.mp4'],
    'one argument, no space after the comma — the only spelling explorer understands');
  assert.equal(revealCommand('C:\\out', { platform: 'win32' }).ignoreExit, true, 'explorer exits 1 even when it worked');
});

test('the sign-in flow no longer names a macOS binary', async () => {
  const { readFileSync } = await import('node:fs');
  const auth = readFileSync(new URL('../src/license/auth.js', import.meta.url), 'utf8');
  assert.ok(!auth.includes('/usr/bin/open'), 'the browser is opened through the portable helper');
  assert.match(auth, /openExternal\(authorizeUrl/);
});
