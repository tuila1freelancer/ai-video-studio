import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
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

test('a new channel lands where the operating system keeps videos', async () => {
  const { defaultChannelsRoot } = await import('../src/db/repositories/channels.js');
  const { homedir } = await import('node:os');
  assert.equal(defaultChannelsRoot('darwin', {}), join(homedir(), 'Movies', 'AI Video Studio'));
  assert.equal(defaultChannelsRoot('win32', {}), join(homedir(), 'Videos', 'AI Video Studio'),
    'Windows has no Movies folder — the old shared answer made one nobody looks in');
  assert.equal(defaultChannelsRoot('linux', { AVS_CHANNELS_DIR: '/data/channels' }), '/data/channels',
    'a server mounts its volume where it means to');
});
