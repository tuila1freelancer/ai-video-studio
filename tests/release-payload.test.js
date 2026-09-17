// What a customer can read after double-clicking the .app.
//
// Every assertion here guards a hole that was measured on the SHIPPED v1.0.0 zip: DevTools was on,
// 519 dependency READMEs travelled with the build, `src/.DS_Store` was in there, and the whole
// transition doctrine was visible in `ps` because the filtergraph rode in argv.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detachFilterGraph } from '../src/media/ffmpeg.js';
import { ffmpeg } from '../src/media/ffmpeg.js';

const swift = sourceOf('shell/main.swift');
const build = sourceOf('shell/build-app.sh');

test('the dist payload ships bytecode, and the launcher can start it', () => {
  // The three halves of one contract: no src/ in the payload, --no-lazy on the command line
  // (without it V8 hands the loader nothing), and the key delivered over stdin rather than argv
  // or the environment, both of which `ps` prints back to whoever asks.
  assert.doesNotMatch(build, /cp -R src public/, 'src/ must not travel');
  assert.match(build, /--key "\$APP_KEY"/);
  assert.match(build, /let NODE_ARGS = \[\$NODE_FLAGS_SWIFT "loader\.cjs"\]/);
  assert.match(swift, /p\.arguments = NODE_ARGS/);
  assert.match(swift, /stdinPipe\.fileHandleForWriting\.write\(Data\(\(APP_KEY \+ "\\n"\)\.utf8\)\)/);
  assert.doesNotMatch(swift, /env\["APP_KEY"\]/, 'the key must never reach the environment');
  // And the build refuses to ship a payload that still has source in it.
  assert.match(build, /payload vẫn còn mã nguồn trong src\//);
});

test('the UI ships hashed and split: one entry, preloaded static graph, lazy chunks, no dead hints', async () => {
  const { mkdtempSync: mk } = await import('node:fs');
  const out = join(mk(join(tmpdir(), 'avs-fe-')), 'public');
  try {
    execFileSync(process.execPath, [
      new URL('../scripts/build-frontend.mjs', import.meta.url).pathname, '--out', out,
    ], { stdio: 'pipe' });
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    // The document ships assembled: no include marker survives and the partials stay behind.
    assert.doesNotMatch(html, /<!--#include/);
    assert.match(html, /id="settingsModal"/);
    assert.equal(existsSync(join(out, 'partials')), false, 'partials/ is not part of the payload');
    // Every script and stylesheet the document names carries a content hash and exists on disk —
    // a hint to a missing file is a 404 on first paint, and an unhashed name can be served stale.
    const entry = html.match(/<script type="module" src="([^"]+)"><\/script>/)[1];
    assert.match(entry, /^\/js\/main-[A-Z0-9]{8}\.js$/);
    const preloads = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
    const sheets = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(preloads[0], entry, 'the entry is the first hint');
    assert.ok(preloads.length > 3, 'the static import graph is hinted, not just the entry');
    assert.deepEqual(sheets.map((s) => s.replace(/-[A-Z0-9]{8}\.css$/, '.css')), ['/css/fonts.css', '/css/app.css']);
    for (const ref of [...preloads, ...sheets]) {
      assert.match(ref, /-[A-Z0-9]{8}\.(?:js|css)$/, `${ref} is not content-hashed`);
      assert.ok(existsSync(join(out, ref)), `${ref} is referenced but not in the payload`);
    }
    // Lazy screens are chunks the entry does not preload: they load when a click asks for them.
    const chunks = readdirSync(join(out, 'js', 'chunks'));
    const lazy = chunks.filter((f) => !preloads.some((p) => p.endsWith(f)));
    assert.ok(lazy.some((f) => /^guide-/.test(f)) && lazy.some((f) => /^voicepicker-/.test(f)), `lazy chunks: ${lazy.join(', ')}`);
    const bundled = readFileSync(join(out, entry), 'utf8');
    assert.doesNotMatch(bundled, /^\s*\/\//m, 'minified: no comments survive');
    assert.equal(bundled.includes('renderFingerprint and ttsFingerprint know'), false,
      'the one engine comment that leaked into the frontend goes with them');
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
});

test('a shipped build has no Inspect Element', () => {
  assert.doesNotMatch(swift, /setValue\(true,\s*forKey:\s*"developerExtrasEnabled"\)/,
    'an unconditional `true` here ships the inspector to every customer');
  // Dev keeps the inspector; the flag is the one the dist build already sets for the backend.
  assert.match(swift, /setValue\(EXTRA_ENV\["AVS_DIST"\] != "1", forKey: "developerExtrasEnabled"\)/);
  assert.match(build, /"AVS_DIST": "1"/);
});

test('the dist payload is scrubbed, and licences survive the scrub', () => {
  // Resources, not just Resources/app: the vendored Node runtime shipped 141 markdown files and
  // 90 sourcemaps until the audit caught that the scrub stopped at the payload boundary.
  assert.match(build, /^\s*scrub_payload "\$APP\/Contents\/Resources"$/m, 'the dist block must call the scrub');

  const dir = mkdtempSync(join(tmpdir(), 'avs-scrub-'));
  try {
    mkdirSync(join(dir, 'node_modules', 'pend', 'test'), { recursive: true });
    const files = {
      '.DS_Store': 'junk',
      'README.md': '# how this stack is built',
      'LICENSE': 'MIT',
      'LICENSE.md': 'MIT',
      'server.js': 'keep me',
      'types.d.ts': 'declare module',
      'bundle.js.map': '{}',
      'node_modules/pend/index.js': 'keep me too',
      'node_modules/pend/test/test.js': 'dependency test',
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);

    // Run the real function out of the real script rather than a copy of its rules.
    const fn = build.match(/^scrub_payload\(\) \{[\s\S]*?^\}$/m);
    assert.ok(fn, 'scrub_payload must be a top-level shell function the test can source');
    const script = join(dir, '..', `scrub-${process.pid}.sh`);
    writeFileSync(script, `${fn[0]}\nscrub_payload "$1"\n`);
    try {
      execFileSync('/bin/bash', [script, dir]);
    } finally {
      rmSync(script, { force: true });
    }

    const gone = ['.DS_Store', 'README.md', 'types.d.ts', 'bundle.js.map', 'node_modules/pend/test'];
    for (const f of gone) assert.equal(existsSync(join(dir, f)), false, `${f} must not ship`);
    // MIT and friends require the licence to travel with the code — the scrub must not be greedy.
    for (const f of ['LICENSE', 'LICENSE.md', 'server.js', 'node_modules/pend/index.js']) {
      assert.equal(existsSync(join(dir, f)), true, `${f} must survive`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the filtergraph never rides in argv, where ps can read it', () => {
  const graph = '[0:v][1:v]xfade=transition=fadeblack:duration=0.35:offset=1.0[out]';
  const { args, cleanup } = detachFilterGraph(['-i', 'a.mp4', '-filter_complex', graph, 'out.mp4']);
  try {
    assert.equal(args.includes('-filter_complex'), false);
    assert.equal(args.includes(graph), false, 'the doctrine itself must not be an argument');
    const at = args.indexOf('-filter_complex_script');
    assert.ok(at > 0);
    assert.equal(readFileSync(args[at + 1], 'utf8'), graph, 'byte-identical, or ffmpeg sees a different graph');
  } finally {
    cleanup();
  }

  const plain = detachFilterGraph(['-i', 'a.mp4', '-c', 'copy', 'out.mp4']);
  assert.deepEqual(plain.args, ['-i', 'a.mp4', '-c', 'copy', 'out.mp4']);
});

test('the real binary accepts the detached graph, and the temp file does not linger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'avs-fg-'));
  const out = join(dir, 'x.mp4');
  try {
    const { args, cleanup } = detachFilterGraph(['-filter_complex', 'nullsrc[out]']);
    const file = args[args.indexOf('-filter_complex_script') + 1];
    cleanup();
    assert.equal(existsSync(file), false, 'cleanup must remove the graph');

    await ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1',
      '-filter_complex', '[0:v][1:v]xfade=transition=fadeblack:duration=0.2:offset=0.5[out]',
      '-map', '[out]', '-t', '1', '-pix_fmt', 'yuv420p', out,
    ]);
    assert.equal(existsSync(out), true, 'a real xfade must still render');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
