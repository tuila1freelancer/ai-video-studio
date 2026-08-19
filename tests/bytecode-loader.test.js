// The bytecode payload, and the three ways it must refuse to limp on.
//
// A release ships app.jsc and no JavaScript at all, so the loader has nothing to fall back to —
// and that is the design. A loader that quietly recompiled from source would put the source back
// in the bundle with nobody the wiser, which is the exact outcome this whole phase exists to stop.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = join(REPO, 'vendor', 'node', 'bin', 'node');

// One compile, shared by every case below.
const dir = mkdtempSync(join(tmpdir(), 'avs-jsc-'));
mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, [
  join(REPO, 'scripts', 'build-bytecode.mjs'),
  '--in', join(REPO, 'tests', 'fixtures', 'bytecode-probe.cjs'),
  '--out', dir,
], { stdio: 'pipe' });

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a function V8 never compiled at load still runs from the placeholder source', () => {
  const out = execFileSync(NODE, ['--no-lazy', join(dir, 'loader.cjs')], { encoding: 'utf8' });
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

test('booting without --no-lazy stops, and says so', () => {
  const r = spawnSync(NODE, [join(dir, 'loader.cjs')], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'a flag mismatch must be fatal, never a silent half-boot');
  assert.match(r.stderr, /AVS_BOOT_FAILED/);
  assert.match(r.stderr, /--no-lazy/, 'the message must name the likeliest cause');
});

test('a damaged app.jsc stops, and says so', () => {
  const jsc = join(dir, 'app.jsc');
  const good = readFileSync(jsc);
  const bad = Buffer.from(good);
  bad.fill(0, 64, 256); // corrupt the payload, keep the length
  writeFileSync(jsc, bad);
  try {
    const r = spawnSync(NODE, ['--no-lazy', join(dir, 'loader.cjs')], { encoding: 'utf8' });
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
