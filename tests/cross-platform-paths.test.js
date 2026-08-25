// The binary resolver is the only thing that ever pinned this app to macOS. It is now a pure
// function of (platform, env, what exists on disk), which is what lets a Mac verify the Windows
// branch: the shapes are asserted here, the actual Windows run still has to happen on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePaths } from '../src/config/paths.js';

test('cross-platform: /usr/bin/say is offered on macOS and nowhere else', () => {
  assert.equal(resolvePaths('win32', {}).say, null, 'Windows has no `say` to point at');
  assert.equal(resolvePaths('linux', {}).say, null);
  // On the machine running the suite `say` resolves only when the file is really there.
  const mac = resolvePaths('darwin', {}).say;
  assert.ok(mac === null || mac === '/usr/bin/say');
});

test('cross-platform: the macOS reference bundle never leaks into a Windows candidate list', () => {
  const win = resolvePaths('win32', {});
  for (const [key, value] of Object.entries(win)) {
    assert.ok(!String(value || '').includes('.app/Contents'),
      `${key} points into a macOS .app bundle, which cannot exist on Windows`);
  }
});

test('cross-platform: an explicit env override wins on every platform', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const p = resolvePaths(platform, { AVS_FFMPEG: '/x/ffmpeg', AVS_CHROME: '/x/chrome', AVS_SAY: '/x/say' });
    assert.equal(p.ffmpeg, '/x/ffmpeg', `${platform}: AVS_FFMPEG ignored`);
    assert.equal(p.chrome, '/x/chrome', `${platform}: AVS_CHROME ignored`);
    assert.equal(p.say, '/x/say', `${platform}: AVS_SAY ignored`);
  }
});

test('cross-platform: resolving for another platform never throws, even with an empty env', () => {
  for (const platform of ['darwin', 'win32', 'linux', 'freebsd']) {
    assert.doesNotThrow(() => resolvePaths(platform, {}));
  }
});

// The closing block is the part the polish pass silently rewrites: measured twice on real runs,
// the model dropped "ấn thích"/"chia sẻ video" from a fixed CTA and invented a promise of upcoming
// videos the owner had banned. Overall coverage cannot catch it — losing the whole ending of a
// 2,500-word script barely moves the number — so the tail is guarded on its own.
test('master script: polish mode is told the owner closing is final copy', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/content/master-script.js', import.meta.url), 'utf8');
  assert.match(src, /is FINAL COPY/, 'polish mode must declare the closing block untouchable');
  assert.match(src, /do NOT add a subscribe line/, 'the old "(subscribe)" instruction invited the rewrite');
  assert.match(src, /ENDING_REWRITTEN/, 'a rewritten ending must be a named defect, not a silent pass');
  assert.match(src, /function tailTokens/, 'the tail must be measured separately from overall coverage');
});
