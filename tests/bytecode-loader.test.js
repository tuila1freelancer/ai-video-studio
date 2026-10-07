// The bytecode payload, and the three ways it must refuse to limp on.
//
// A release ships app.jsc and no JavaScript at all, so the loader has nothing to fall back to —
// and that is the design. A loader that quietly recompiled from source would put the source back
// in the bundle with nobody the wiser, which is the exact outcome this whole phase exists to stop.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
// The release compiles with the vendored runtime; a checkout without one (CI, a fresh clone) uses
// the runtime running the tests — bytecode only has to match the node that loads it.
const VENDORED = join(REPO, 'vendor', 'node', 'bin', 'node');
const NODE = existsSync(VENDORED) ? VENDORED : process.execPath;
const BUILD_ENV = { ...process.env, AVS_BYTECODE_NODE: NODE };
const { V8_FLAGS } = await import('../scripts/bytecode-flags.mjs');

// One compile, shared by every case below.
const dir = mkdtempSync(join(tmpdir(), 'avs-jsc-'));
mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, [
  join(REPO, 'scripts', 'build-bytecode.mjs'),
  '--in', join(REPO, 'tests', 'fixtures', 'bytecode-probe.cjs'),
  '--out', dir,
], { stdio: 'pipe', env: BUILD_ENV });

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a function V8 never compiled at load still runs from the placeholder source', () => {
  const out = execFileSync(NODE, [...V8_FLAGS, join(dir, 'loader.cjs')], { encoding: 'utf8' });
  const got = JSON.parse(out);
  assert.equal(got.deep, 'DOCTRINE-CANARY-9f2b', 'lazy compilation from a blank source would throw here');
  // The CJS wrapper has to arrive intact, or half the app's path handling breaks at runtime.
  assert.equal(got.dirname, 'string');
  assert.equal(got.req, 'function');
});

test('bytecode hides the code and keeps the strings — which is why A4 exists', () => {
  const jsc = readFileSync(join(dir, 'app.jsc'));
  // Measured, not assumed. --no-lazy compiles every function eagerly, so every string literal
  // lands in the constant pool: `strings app.jsc` still reads the prompts straight out. Bytecode
  // buys opacity for the CODE, never for the TEXT — the doctrine has to be encrypted separately.
  assert.equal(jsc.includes(Buffer.from('DOCTRINE-CANARY-9f2b')), true,
    'if this ever flips, re-measure before trusting bytecode alone with the prompts');
  // The shape of the program, though, is genuinely gone: no statements, no identifiers to read.
  assert.equal(jsc.includes(Buffer.from('const deep')), false);
  assert.equal(jsc.includes(Buffer.from('console.log(JSON.stringify')), false);
});

test('booting with the wrong V8 flags stops, and names the missing one', () => {
  for (const flag of V8_FLAGS) {
    const r = spawnSync(NODE, [...V8_FLAGS.filter((f) => f !== flag), join(dir, 'loader.cjs')], { encoding: 'utf8' });
    assert.equal(r.status, 1, `dropping ${flag} must be fatal, never a silent half-boot`);
    assert.match(r.stderr, /AVS_BOOT_FAILED/);
    // --no-lazy is caught by V8 rejecting the cache; --no-flush-bytecode only shows up minutes
    // later under GC, so the loader has to check the recorded list itself.
    assert.match(r.stderr, new RegExp(`${flag}|--no-lazy`), `the message must name ${flag}`);
  }
});

test('the flag list the payload records is the one the launcher passes', () => {
  const recorded = JSON.parse(readFileSync(join(dir, 'app.jsc.json'), 'utf8')).flags;
  assert.deepEqual(recorded, V8_FLAGS);
  const build = readFileSync(join(REPO, 'shell', 'build-app.sh'), 'utf8');
  assert.match(build, /NODE_FLAGS_SWIFT="\$\(node -e "import\('\.\/scripts\/bytecode-flags\.mjs'\)/,
    'Config.swift must read the same list, not a copy of it');
  assert.match(build, /let NODE_ARGS = \[\$NODE_FLAGS_SWIFT "loader\.cjs"\]/);
});

test('a damaged app.jsc stops, and says so', () => {
  const jsc = join(dir, 'app.jsc');
  const good = readFileSync(jsc);
  const bad = Buffer.from(good);
  bad.fill(0, 64, 256); // corrupt the payload, keep the length
  writeFileSync(jsc, bad);
  try {
    const r = spawnSync(NODE, [...V8_FLAGS, join(dir, 'loader.cjs')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AVS_BOOT_FAILED/);
  } finally {
    writeFileSync(jsc, good);
  }
});

test('the loader owns no path back to source', () => {
  const loader = readFileSync(join(REPO, 'scripts', 'loader.cjs'), 'utf8');
  assert.doesNotMatch(loader, /catch[\s\S]{0,120}(require|runInThisContext|new vm\.Script)\(/,
    'recovering by compiling something else is the one thing this file must never do');
  // Three guards, three exits: unreadable metadata, wrong V8, rejected cache, no wrapper.
  assert.equal((loader.match(/die\(/g) || []).length >= 4, true);
});

// ---------------------------------------------------------------------------
// Encrypted payload — what a release actually ships
// ---------------------------------------------------------------------------

const KEY = 'a'.repeat(64);
const encDir = mkdtempSync(join(tmpdir(), 'avs-jsc-enc-'));
execFileSync(process.execPath, [
  join(REPO, 'scripts', 'build-bytecode.mjs'),
  '--in', join(REPO, 'tests', 'fixtures', 'bytecode-probe.cjs'),
  '--out', encDir, '--key', KEY,
], { stdio: 'pipe', env: BUILD_ENV });

test.after(() => rmSync(encDir, { recursive: true, force: true }));

test('encryption is what actually removes the text from disk', () => {
  const jsc = readFileSync(join(encDir, 'app.jsc'));
  // The same canary that survives plain bytecode as UTF-16 is gone in both encodings.
  assert.equal(jsc.includes(Buffer.from('DOCTRINE-CANARY-9f2b', 'latin1')), false);
  assert.equal(jsc.includes(Buffer.from('DOCTRINE-CANARY-9f2b', 'utf16le')), false);
  assert.equal(JSON.parse(readFileSync(join(encDir, 'app.jsc.json'), 'utf8')).encrypted, true);
});

test('the key arrives on stdin, and the app runs', () => {
  const out = execFileSync(NODE, [...V8_FLAGS, join(encDir, 'loader.cjs')], {
    encoding: 'utf8',
    input: `${KEY}\n`,
  });
  assert.equal(JSON.parse(out).deep, 'DOCTRINE-CANARY-9f2b');
});

test('a wrong key is fatal, and so is a tampered file', () => {
  const wrong = spawnSync(NODE, [...V8_FLAGS, join(encDir, 'loader.cjs')], {
    encoding: 'utf8',
    input: `${'b'.repeat(64)}\n`,
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /wrong key or the file was modified/);

  // GCM authenticates, so a flipped byte and a wrong key are the same refusal — which is what
  // keeps a patched app.jsc from booting at all.
  const jsc = join(encDir, 'app.jsc');
  const good = readFileSync(jsc);
  const bad = Buffer.from(good);
  bad[bad.length - 20] ^= 0xff;
  writeFileSync(jsc, bad);
  try {
    const tampered = spawnSync(NODE, [...V8_FLAGS, join(encDir, 'loader.cjs')], {
      encoding: 'utf8', input: `${KEY}\n`,
    });
    assert.equal(tampered.status, 1);
    assert.equal(tampered.signal, null);
    assert.match(tampered.stderr, /AVS_BOOT_FAILED/);
  } finally {
    writeFileSync(jsc, good);
  }
});

test('no key at all is refused rather than guessed at', () => {
  const r = spawnSync(NODE, [...V8_FLAGS, join(encDir, 'loader.cjs')], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /invalid decryption key/);
});
