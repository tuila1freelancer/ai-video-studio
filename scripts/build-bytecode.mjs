#!/usr/bin/env node
// Turn the bundle into V8 bytecode, so the payload carries no readable JavaScript at all.
//
//   node scripts/build-bytecode.mjs [--in dist/bundle/server.cjs] [--out dist/bundle] [--key <hex>]
//
// Two rules decide everything here, both measured on this exact runtime (node 22.22.1) rather than
// assumed:
//
//   1. V8 accepts cached data against a placeholder source of the SAME LENGTH — that is what lets
//      the real text stay behind. Same length, or the cache is rejected.
//   2. It only works if `--no-lazy` is set on BOTH sides. Compiled lazily, every function that was
//      not called during load is compiled from the placeholder at first call and dies on
//      "Unexpected end of input". Compiled with --no-lazy and RUN without it, the cache yields
//      nothing at all and the loader gets `undefined` instead of a function.
//
// Hence: this script re-execs itself under the vendored runtime with --no-lazy, and the loader it
// writes records the V8 build so a mismatched runtime is caught at boot instead of at 3am.
//
// With --key the bytecode is encrypted on disk. Bytecode alone does NOT hide text: every string
// literal sits in V8's constant pool, and a byte scan of the real app.jsc pulls the whole codegen
// doctrine out as UTF-16. Encrypting the file covers all of it at once, with none of the risk of
// picking string literals out of a minified bundle by hand. The key is not stored beside it — the
// launcher feeds it over stdin, so it is neither on disk nor visible in `ps`.
import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_NODE = join(ROOT, 'vendor', 'node', 'bin', 'node');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const inFile = resolve(ROOT, arg('in', join('dist', 'bundle', 'server.cjs')));
const outDir = resolve(ROOT, arg('out', join('dist', 'bundle')));
const keyHex = arg('key', '');
if (keyHex && !/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('--key phải là 32 byte hex');

// The runtime that ships is the runtime that must compile: cached data is tied to the V8 build.
if (process.execPath !== VENDOR_NODE || !process.execArgv.includes('--no-lazy')) {
  const r = spawnSync(VENDOR_NODE, ['--no-lazy', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const source = readFileSync(inFile, 'utf8');
const wrapped = Module.wrap(source);
const script = new vm.Script(wrapped, { produceCachedData: true, filename: 'server.cjs' });
if (!script.cachedData) throw new Error('V8 produced no cached data');

const jsc = join(outDir, 'app.jsc');
// The digest is of the PLAINTEXT bytecode either way, so the loader checks what V8 will actually
// receive rather than what happened to be on disk.
const sha256 = createHash('sha256').update(script.cachedData).digest('hex');

let onDisk = script.cachedData;
if (keyHex) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(script.cachedData), cipher.final()]);
  onDisk = Buffer.concat([iv, cipher.getAuthTag(), body]);
}
writeFileSync(jsc, onDisk);
writeFileSync(join(outDir, 'app.jsc.json'), `${JSON.stringify({
  // The placeholder the loader rebuilds. Off by one byte and V8 rejects the whole cache.
  sourceLength: wrapped.length,
  v8: process.versions.v8,
  node: process.versions.node,
  encrypted: Boolean(keyHex),
  // Not a security measure — a corrupt download should say so rather than crash mid-boot.
  sha256,
}, null, 2)}\n`);

copyFileSync(join(ROOT, 'scripts', 'loader.cjs'), join(outDir, 'loader.cjs'));

console.log(`bytecode:  ${relative(ROOT, jsc)}  (${(statSync(jsc).size / 1024).toFixed(0)} KB)`);
console.log(`source:    ${(source.length / 1024).toFixed(0)} KB of JavaScript, none of it shipped`);
console.log(`on disk:   ${keyHex ? 'AES-256-GCM — key arrives over stdin, never stored' : 'PLAINTEXT bytecode (no --key: strings -el reads the doctrine)'}`);
console.log(`runtime:   node ${process.versions.node} / V8 ${process.versions.v8} — must match at run time`);
