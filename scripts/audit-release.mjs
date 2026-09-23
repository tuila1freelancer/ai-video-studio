#!/usr/bin/env node
// Read the built .app the way a curious customer would, and refuse to ship if it gives anything up.
//
//   node scripts/audit-release.mjs --app "AI Video Studio.app"
//
// Every check is performed on the ASSEMBLED BUNDLE, never on the source that produced it. The
// point of this file is to catch the build regressing — a `cp -R src` creeping back, a scrub rule
// that stopped matching, an encryption step quietly skipped — none of which any unit test can see.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const APP = resolve(ROOT, arg('app', 'AI Video Studio.app'));
const PAYLOAD = join(APP, 'Contents', 'Resources', 'app');

// Canaries taken from the highest-value files in the repo. If any of these can be read out of the
// bundle, so can everything around them.
const CANARIES = [
  ['hyperframe/prompt/blocks.js', 'SCRIPT RULE (Vietnamese)'],
  ['hyperframe/prompt/system.js', 'TWO SLOTS MAY NEVER BIN INTO THE SAME ZONE'],
  ['animation/harness/runtime-typeset.js', '__fitMarks'],
  ['hyperframe/validate.js', 'SHORT_DECOR'],
  ['pipeline/fingerprint.js', 'RENDER_CFG_KEYS'],
  ['pipeline/stages/script.js', 'MASTER SCRIPT'],
];

const failures = [];
const note = (ok, label, detail) => {
  console.log(`  ${ok ? '✓' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const files = walk(APP);

// 1. No JavaScript source of ours, anywhere.
const ourJs = files.filter((f) => f.startsWith(join(PAYLOAD, 'src')) && f.endsWith('.js'));
note(ourJs.length === 0, 'không còn file src/*.js trong payload', `${ourJs.length} file`);

// 2. The payload entry is bytecode, and it is encrypted.
let meta = null;
try { meta = JSON.parse(readFileSync(join(PAYLOAD, 'app.jsc.json'), 'utf8')); } catch { /* reported below */ }
note(Boolean(meta), 'app.jsc.json có mặt');
note(meta?.encrypted === true, 'bytecode đã được mã hoá', meta ? `v8 ${meta.v8}` : '');

// 3. Housekeeping the old build shipped: 519 dependency READMEs, .DS_Store, sourcemaps.
const junk = {
  '.DS_Store': files.filter((f) => basename(f) === '.DS_Store'),
  'sourcemap': files.filter((f) => f.endsWith('.map')),
  'markdown (trừ licence)': files.filter((f) => /\.(md|markdown)$/i.test(f) && !/licen[cs]e|copying|notice/i.test(basename(f))),
};
for (const [label, hits] of Object.entries(junk)) {
  note(hits.length === 0, `không có ${label}`, hits.length ? `${hits.length}: ${hits.slice(0, 2).map((f) => f.slice(APP.length + 1)).join(', ')}` : '');
}

// 4. The doctrine itself, searched byte-exact in both encodings. UTF-16 matters: the Vietnamese
//    forces two-byte storage, which is why `strings` alone reported the plain bytecode as clean.
let scanned = 0;
const leaks = [];
for (const f of files) {
  if (statSync(f).size > 60e6) continue;
  scanned += 1;
  const buf = readFileSync(f);
  for (const [origin, probe] of CANARIES) {
    if (buf.includes(Buffer.from(probe, 'latin1')) || buf.includes(Buffer.from(probe, 'utf16le'))) {
      leaks.push(`${probe} (${origin}) → ${f.slice(APP.length + 1)}`);
    }
  }
}
note(leaks.length === 0, `không đọc được doctrine trong ${scanned} file`, leaks.join(' | '));

// 5. The launcher runs bytecode, and the window hands over no inspector.
const launcher = readFileSync(join(APP, 'Contents', 'MacOS', 'AI Video Studio'));
note(launcher.includes(Buffer.from('loader.cjs')), 'launcher chạy loader.cjs');
note(launcher.includes(Buffer.from('--no-lazy')), 'launcher truyền --no-lazy', 'thiếu cờ này thì V8 không trả về gì');
note(!launcher.includes(Buffer.from('src/server.js')), 'launcher không còn trỏ vào mã nguồn');
const swift = readFileSync(join(ROOT, 'shell', 'main.swift'), 'utf8');
note(/EXTRA_ENV\["AVS_DIST"\] != "1", forKey: "developerExtrasEnabled"/.test(swift), 'DevTools tắt trong bản dist');

console.log();
if (failures.length) {
  console.error(`✖ Bản dựng KHÔNG đạt: ${failures.length} mục — ${failures.join('; ')}\n`);
  process.exit(1);
}
console.log(`✅ Bản dựng kín: ${scanned} file đã quét, không có mã nguồn hay doctrine nào đọc được.\n`);
