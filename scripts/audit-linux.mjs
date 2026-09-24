#!/usr/bin/env node
// Read the built Linux server payload the way a curious customer would, and refuse to ship if it
// gives anything up. The Linux counterpart of audit-release.mjs (macOS .app) and audit-windows.mjs
// (Electron/asar) — same checks, minus the Electron ones, with the binary test inverted: here ELF
// is what a correct build produces and a Mach-O or PE binary is the bug.
//
//   node scripts/audit-linux.mjs --dist dist/server-linux-x64
//
// Everything is checked on the ASSEMBLED output, never the source: the point is to catch the build
// regressing — src/** creeping back, the encryption step skipped, the key leaking into a readable
// file — none of which a unit test can see. Wired as a hard gate in build-linux.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const DIST = resolve(ROOT, arg('dist', 'dist/server-linux-x64'));
const PAYLOAD = join(DIST, 'app-payload');
const LAUNCHER = join(DIST, 'avs-launcher');
const SQLITE = join(PAYLOAD, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

// The highest-value strings in the repo. If any can be read out of the shipped bytes, so can
// everything around them.
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
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

if (!existsSync(PAYLOAD)) {
  console.error(`✖ không thấy ${PAYLOAD} — chạy build trước`);
  process.exit(1);
}

// 1. No JavaScript source of ours.
const payloadSrc = walk(join(PAYLOAD, 'src')).filter((f) => f.endsWith('.js'));
note(payloadSrc.length === 0, 'không có src/*.js trong payload', `${payloadSrc.length} file`);

// 2. The payload entry is bytecode, and it is encrypted.
let meta = null;
try { meta = JSON.parse(readFileSync(join(PAYLOAD, 'app.jsc.json'), 'utf8')); } catch { /* reported */ }
note(Boolean(meta), 'app.jsc.json có mặt');
note(meta?.encrypted === true, 'bytecode đã được mã hoá', meta ? `v8 ${meta.v8}` : '');
note(!existsSync(join(PAYLOAD, 'server.cjs')), 'bundle nguyên bản không đi kèm');

// 3. Housekeeping.
const distFiles = walk(DIST);
const junk = {
  '.DS_Store': distFiles.filter((f) => basename(f) === '.DS_Store'),
  sourcemap: distFiles.filter((f) => f.endsWith('.map')),
  'markdown (trừ licence)': distFiles.filter((f) => /\.(md|markdown)$/i.test(f) && !/licen[cs]e|copying|notice/i.test(basename(f))),
};
for (const [label, hits] of Object.entries(junk)) {
  note(hits.length === 0, `không có ${label}`, hits.length ? `${hits.length}: ${hits.slice(0, 2).map((f) => f.slice(DIST.length + 1)).join(', ')}` : '');
}

// 4. The doctrine itself, byte-exact in both encodings. UTF-16 matters: Vietnamese forces two-byte
//    storage, which is why `strings` alone reported plain bytecode as clean.
let scanned = 0;
const leaks = [];
for (const f of walk(PAYLOAD)) {
  if (statSync(f).size > 60e6) continue;
  scanned += 1;
  const buf = readFileSync(f);
  for (const [origin, probe] of CANARIES) {
    if (buf.includes(Buffer.from(probe, 'latin1')) || buf.includes(Buffer.from(probe, 'utf16le'))) {
      leaks.push(`${probe} (${origin}) → ${f.slice(DIST.length + 1)}`);
    }
  }
}
note(leaks.length === 0, `không đọc được doctrine trong ${scanned} file`, leaks.join(' | '));

// 5. The launcher runs bytecode and no longer points at source. It legitimately CARRIES the key, so
//    it is never scanned for one.
const launcher = existsSync(LAUNCHER) ? readFileSync(LAUNCHER) : Buffer.alloc(0);
note(launcher.length > 0, 'avs-launcher có mặt');
note(launcher.includes(Buffer.from('loader.cjs')), 'launcher chạy loader.cjs');
note(launcher.includes(Buffer.from('--no-lazy')), 'launcher truyền --no-lazy', 'thiếu cờ này thì V8 không trả về gì');
note(launcher.includes(Buffer.from('AVS_DIST=1')), 'launcher đặt AVS_DIST', 'thiếu thì bypass license sống lại');
note(!launcher.includes(Buffer.from('src/server.js')), 'launcher không trỏ vào mã nguồn');
const elfLauncher = launcher.subarray(0, 4);
note(elfLauncher[0] === 0x7f && elfLauncher[1] === 0x45, 'launcher là ELF/Linux');

// 6. better-sqlite3 is the LINUX binary at the Node ABI — not the macOS Mach-O the host built with.
let sqliteOk = false;
let sqliteWhat = 'thiếu file';
if (existsSync(SQLITE)) {
  const head = readFileSync(SQLITE).subarray(0, 4);
  const isELF = head[0] === 0x7f && head[1] === 0x45; // 0x7f 'E'
  const isMachO = head[0] === 0xcf && head[1] === 0xfa;
  const isPE = head[0] === 0x4d && head[1] === 0x5a; // 'MZ'
  sqliteOk = isELF && !isMachO && !isPE;
  sqliteWhat = isELF ? 'ELF/Linux' : isMachO ? 'Mach-O/macOS (SAI)' : isPE ? 'PE/Windows (SAI)' : 'không nhận dạng';
}
note(sqliteOk, 'better_sqlite3.node là binary Linux', sqliteWhat);

// 7. The runtime that runs the bytecode. A payload for a bare machine carries its own; a container
//    image uses the one it installed, and then the launcher names an absolute path instead.
const runtime = join(DIST, 'node-linux', 'bin', 'node');
if (existsSync(runtime)) {
  const head = readFileSync(runtime).subarray(0, 4);
  note(head[0] === 0x7f && head[1] === 0x45, 'runtime Node đi kèm là ELF/Linux');
} else {
  note(/\/(usr|opt)\/[\w/.-]*node/.test(launcher.toString('latin1')), 'launcher trỏ tới runtime hệ thống',
    'payload không kèm node-linux — đúng với bản image');
}

// 8. The AES key lives ONLY in the launcher. app.jsc.json.sha256 is a legitimate 64-hex value, so
//    the meta is checked by field rather than by scanning for hex.
const keyTokens = /appkey|app_key/i;
const metaClean = meta && !('key' in meta) && !Object.keys(meta).some((k) => keyTokens.test(k));
note(Boolean(metaClean), 'app.jsc.json không chứa khoá');
const loader = existsSync(join(PAYLOAD, 'loader.cjs')) ? readFileSync(join(PAYLOAD, 'loader.cjs'), 'utf8') : '';
note(Boolean(loader) && !/[0-9a-f]{64}/i.test(loader), 'loader.cjs không chứa khoá');

console.log();
if (failures.length) {
  console.error(`✖ Bản dựng KHÔNG đạt: ${failures.length} mục — ${failures.join('; ')}\n`);
  process.exit(1);
}
console.log(`✅ Bản dựng kín: ${scanned} file đã quét, không có mã nguồn hay doctrine nào đọc được.\n`);
