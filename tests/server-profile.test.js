import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { platformName } from '../src/license/config.js';
import { deviceId, deviceInfo } from '../src/license/device.js';

test('the platform string follows the machine, not the build that started it', () => {
  assert.equal(platformName('darwin', 'arm64'), 'macos-arm64');
  assert.equal(platformName('linux', 'x64'), 'linux-x64');
  assert.equal(platformName('win32', 'x64'), 'windows-x64');
  assert.equal(platformName('freebsd', 'x64'), 'freebsd-x64', 'an unknown platform names itself');
  assert.equal(deviceInfo('1.0.0').platform, platformName(), 'the store is told the truth about this machine');
});

test('a deployment can pin its device id, so a restart is not a new machine', async () => {
  const previous = process.env.AVS_DEVICE_ID;
  process.env.AVS_DEVICE_ID = 'deployment-fixed-id';
  try {
    // deviceId caches per process, so the override is read through a fresh module instance.
    const fresh = await import(`../src/license/device.js?pin=${Date.now()}`);
    assert.equal(fresh.deviceId(), 'deployment-fixed-id');
  } finally {
    if (previous === undefined) delete process.env.AVS_DEVICE_ID; else process.env.AVS_DEVICE_ID = previous;
  }
  assert.ok(deviceId().length > 0, 'and without the override there is still an id');
});

test('a headless deployment refuses to pretend a window opened', async () => {
  const { isHeadless, refuseHeadless } = await import('../src/core/headless.js');
  assert.equal(isHeadless({}), false);
  assert.equal(isHeadless({ AVS_HEADLESS: '1' }), true);
  let err;
  try { refuseHeadless('/data/channels/mm/output'); } catch (e) { err = e; }
  assert.equal(err.code, 'headless');
  assert.equal(err.status, 501);
  assert.equal(err.path, '/data/channels/mm/output', 'the path is what the caller wanted the window for');
});

test('per-language subtitle fonts name faces the machine actually has', async () => {
  const { SUBTITLE_PRESETS } = await import('../src/subtitles/presets.js');
  assert.ok(SUBTITLE_PRESETS.length, 'presets load');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/subtitles/presets.js', import.meta.url), 'utf8');
  assert.match(source, /platform === 'linux'/, 'the table branches on the platform');
  assert.match(source, /Noto Sans CJK JP/, 'and names the families a container installs');
  const { isSystemFamily } = await import('../src/fonts/files.js');
  for (const family of ['Noto Sans CJK JP', 'Noto Sans Thai', 'Noto Sans Devanagari', 'Hiragino Sans', 'PingFang SC']) {
    assert.equal(isSystemFamily(family), true, `${family} must count as a system face, or the burn hunts for a file`);
  }
});
