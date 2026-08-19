#!/usr/bin/env node
// Runs the app from bytecode. Copied verbatim into the payload by build-bytecode.mjs.
//
// There is no JavaScript source in a release to fall back to, and that is deliberate: a loader
// that quietly recompiled from source would mean shipping the source again without anyone
// noticing. Every failure below therefore stops the process and says why.
//
// MUST be started with --no-lazy. The cache was produced under that flag, and V8 hands back
// nothing at all when the two sides disagree.
'use strict';
const { createHash } = require('node:crypto');
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

const cachedData = readFileSync(join(HERE, 'app.jsc'));
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
