// The bundle must land on the same root the repo run does.
//
// paths.js finds ROOT by climbing from its own file, and ROOT is what locates vendor/ffmpeg and —
// when the launcher does not override it — DATA_DIR. Bundling collapses src/config/paths.js into a
// single file at the payload root, so the old two-level climb would land one directory too high:
// vendor lookups would miss and the customer would silently get whatever ffmpeg their machine had.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleOptions } from '../scripts/build-bundle.mjs';
import { DIRS, PATHS, ROOT } from '../src/config/paths.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

test('a bundled payload resolves ROOT to itself, not one level above', async () => {
  // realpath: on macOS /var is a symlink to /private/var, and paths.js reports the resolved form.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'avs-payload-')));
  const app = join(tmp, 'app');
  mkdirSync(join(app, 'public'), { recursive: true });
  mkdirSync(join(app, 'vendor', 'ffmpeg'), { recursive: true });
  // The two markers that identify a payload root, plus a vendored binary to prove ROOT found it.
  cpSync(join(REPO, 'package.json'), join(app, 'package.json'));
  writeFileSync(join(app, 'vendor', 'ffmpeg', 'ffmpeg'), '#!/bin/sh\n');

  try {
    await build(bundleOptions(join(REPO, 'tests', 'fixtures', 'root-probe.js'), join(app, 'probe.cjs')));
    const out = execFileSync(process.execPath, [join(app, 'probe.cjs')], {
      encoding: 'utf8',
      // AVS_DATA_DIR unset on purpose: the fallback is exactly the path that would move a
      // customer's library if the climb were wrong.
      env: { ...process.env, AVS_DATA_DIR: '' },
    });
    const got = JSON.parse(out);

    assert.equal(got.ROOT, app, 'ROOT must be the payload directory itself');
    assert.equal(got.data, join(app, 'data'));
    assert.equal(got.projects, join(app, 'data', 'projects'));
    assert.equal(got.ffmpegAss, join(app, 'vendor', 'ffmpeg', 'ffmpeg'),
      'the vendored binary is only found when ROOT is right');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('running from the repo is unchanged by any of this', () => {
  assert.equal(ROOT, REPO);
  assert.equal(DIRS.data, process.env.AVS_DATA_DIR || join(REPO, 'data'));
  assert.ok(PATHS.ffmpeg, 'ffmpeg still resolves');
});

test('the entry point carries no top-level await, or the bytecode step cannot compile it', () => {
  const src = execFileSync('/bin/cat', [join(REPO, 'src', 'server.js')], { encoding: 'utf8' });
  const topLevel = src.split('\n').filter((l) => /^(await |const .*= await |let .*= await )/.test(l));
  assert.deepEqual(topLevel, [], 'top-level await makes the bundle an ES module, which vm.Script cannot compile');
  assert.match(src, /^async function boot\(\) \{$/m);
  assert.match(src, /^boot\(\)\.catch\(/m);
});
