#!/usr/bin/env node
// Runs the app from bytecode. Copied verbatim into the payload by build-bytecode.mjs.
//
// There is no JavaScript source in a release to fall back to, and that is deliberate: a loader
// that quietly recompiled from source would mean shipping the source again without anyone
// noticing. Every failure below therefore stops the process and says why.
//
// MUST be started with the flags recorded in app.jsc.json. V8 hashes them into the cached data,
// and a mismatch is either an outright rejection or — for --no-flush-bytecode — a process that
// serves happily for minutes and then throws SyntaxError out of a route handler, because V8 threw
// the bytecode away and tried to recompile it from a source made of spaces.
'use strict';
const { createDecipheriv, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');

const HERE = __dirname;
const die = (why) => {
  console.error(`AVS_BOOT_FAILED ${why}`);
  process.exit(1);
};

let meta;
try {
  meta = JSON.parse(readFileSync(join(HERE, 'app.jsc.json'), 'utf8'));
} catch (e) {
  die(`không đọc được app.jsc.json: ${e.message}`);
}

if (meta.v8 !== process.versions.v8) {
  die(`bytecode dựng cho V8 ${meta.v8}, runtime này là V8 ${process.versions.v8} — dựng lại bản phát hành`);
}

// Checked before anything runs, so a missing flag is a refusal at boot rather than a failure an
// hour into a render.
const missing = (meta.flags || []).filter((f) => !process.execArgv.includes(f));
if (missing.length) die(`thiếu cờ V8: ${missing.join(' ')} — launcher phải chạy node với đúng các cờ này`);

let cachedData = readFileSync(join(HERE, 'app.jsc'));

if (meta.encrypted) {
  // The key comes down stdin from the launcher: not beside the ciphertext on disk, and not in the
  // environment where `ps -E` would print it back. Recovering it means disassembling the launcher
  // or attaching a debugger — which is the honest ceiling for anything running on the user's own
  // machine, and the reason the doctrine moves server-side in phase B.
  if (process.stdin.isTTY) die('thiếu khoá giải mã — app này phải được mở từ AI Video Studio.app');
  let keyHex = '';
  try {
    keyHex = readFileSync(0, 'utf8').trim();
  } catch (e) {
    die(`không đọc được khoá giải mã: ${e.message}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) die('khoá giải mã không hợp lệ');
  try {
    const iv = cachedData.subarray(0, 12);
    const tag = cachedData.subarray(12, 28);
    const body = cachedData.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(tag);
    cachedData = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // GCM authenticates: a wrong key and a tampered file are the same failure, and both are fatal.
    die('không giải mã được app.jsc — sai khoá hoặc file đã bị sửa');
  }
}

// Checked BEFORE V8 sees it: handed a truncated or half-written app.jsc, V8 does not return an
// error, it takes the process down with a signal. A half-finished download must report itself.
const digest = createHash('sha256').update(cachedData).digest('hex');
if (digest !== meta.sha256) die('app.jsc hỏng hoặc tải thiếu — tải lại bản cài đặt');

const filename = join(HERE, 'server.cjs');
// Same length, different bytes: V8 checks the length of the source, never its text.
const script = new vm.Script(' '.repeat(meta.sourceLength), { cachedData, filename });
// The likeliest cause by far is a missing --no-lazy, because the cache was built with it.
if (script.cachedDataRejected) die('V8 từ chối bytecode — thiếu --no-lazy, hoặc sai phiên bản runtime');

const wrapper = script.runInThisContext();
if (typeof wrapper !== 'function') {
  die('bytecode không trả về module wrapper — thiếu --no-lazy khi chạy');
}

const mod = new Module(filename, null);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(HERE);
wrapper.call(mod.exports, mod.exports, Module.createRequire(filename), mod, filename, HERE);
