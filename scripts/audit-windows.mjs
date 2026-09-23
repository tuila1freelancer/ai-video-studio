#!/usr/bin/env node
// Read the built Windows app the way a curious customer would, and refuse to ship if it gives
// anything up. The Windows counterpart of audit-release.mjs (which only understands the macOS .app).
//
//   node scripts/audit-windows.mjs --dist dist/electron/win-unpacked
//
// Everything is checked on the ASSEMBLED output, never the source: the point is to catch the build
// regressing — src/** creeping back into the asar, the encryption step skipped, the key leaking into
// readable JS — none of which a unit test can see. Wired as a hard gate in build-windows.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const DIST = resolve(ROOT, arg('dist', 'dist/electron/win-unpacked'));
const RESOURCES = join(DIST, 'resources');
const ASAR = join(RESOURCES, 'app.asar');
const PAYLOAD = join(RESOURCES, 'app-payload');
const LAUNCHER = join(RESOURCES, 'avs-launcher.exe');
const SQLITE = join(PAYLOAD, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

// Same canaries as audit-release.mjs: the highest-value strings in the repo. If any can be read out
// of the shipped bytes, so can everything around them.
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

if (!existsSync(RESOURCES)) {
  console.error(`✖ không thấy ${RESOURCES} — chạy build trước`);
  process.exit(1);
}

// 1. No JavaScript source of ours — not in the asar, not in the payload.
let asarPaths = [];
try { asarPaths = asar.listPackage(ASAR); } catch (e) { note(false, 'đọc được app.asar', e.message); }
const asarSrc = asarPaths.filter((p) => /(^|[/\\])src[/\\].*\.js$/i.test(p));
note(asarSrc.length === 0, 'không có src/*.js trong app.asar', asarSrc.slice(0, 3).join(', '));
const payloadSrc = walk(join(PAYLOAD, 'src')).filter((f) => f.endsWith('.js'));
note(payloadSrc.length === 0, 'không có src/*.js trong payload', `${payloadSrc.length} file`);

// 2. The payload entry is bytecode, and it is encrypted.
let meta = null;
try { meta = JSON.parse(readFileSync(join(PAYLOAD, 'app.jsc.json'), 'utf8')); } catch { /* reported */ }
note(Boolean(meta), 'app.jsc.json có mặt');
note(meta?.encrypted === true, 'bytecode đã được mã hoá', meta ? `v8 ${meta.v8}` : '');

// 3. Housekeeping.
const resFiles = walk(RESOURCES);
const junk = {
  '.DS_Store': resFiles.filter((f) => basename(f) === '.DS_Store'),
  sourcemap: resFiles.filter((f) => f.endsWith('.map')),
  'markdown (trừ licence)': resFiles.filter((f) => /\.(md|markdown)$/i.test(f) && !/licen[cs]e|copying|notice/i.test(basename(f))),
};
for (const [label, hits] of Object.entries(junk)) {
  note(hits.length === 0, `không có ${label}`, hits.length ? `${hits.length}: ${hits.slice(0, 2).map((f) => f.slice(RESOURCES.length + 1)).join(', ')}` : '');
}

// 4. The doctrine itself, byte-exact in both encodings — over the app.asar blob (a src regression
//    shows up verbatim inside the archive) and every payload file. UTF-16 matters: Vietnamese forces
//    two-byte storage, which is why `strings` alone reported plain bytecode as clean.
let scanned = 0;
const leaks = [];
for (const f of [ASAR, ...walk(PAYLOAD)]) {
  if (!existsSync(f) || statSync(f).size > 60e6) continue;
  scanned += 1;
  const buf = readFileSync(f);
  for (const [origin, probe] of CANARIES) {
    if (buf.includes(Buffer.from(probe, 'latin1')) || buf.includes(Buffer.from(probe, 'utf16le'))) {
      leaks.push(`${probe} (${origin}) → ${f.slice(RESOURCES.length + 1)}`);
    }
  }
}
note(leaks.length === 0, `không đọc được doctrine trong ${scanned} file`, leaks.join(' | '));

// 5. The launcher runs bytecode and no longer points at source. It legitimately CARRIES the key, so
//    it is never scanned for one.
const launcher = existsSync(LAUNCHER) ? readFileSync(LAUNCHER) : Buffer.alloc(0);
note(launcher.length > 0, 'avs-launcher.exe có mặt');
note(launcher.includes(Buffer.from('loader.cjs')), 'launcher chạy loader.cjs');
note(launcher.includes(Buffer.from('--no-lazy')), 'launcher truyền --no-lazy', 'thiếu cờ này thì V8 không trả về gì');
note(!launcher.includes(Buffer.from('src/server.js')) && !launcher.includes(Buffer.from('src\\server.js')), 'launcher không trỏ vào mã nguồn');

// 6. The Electron main process hands over no inspector and stays isolated.
let mainCjs = '';
for (const name of ['shell/electron/main.cjs', '/shell/electron/main.cjs']) {
  try { mainCjs = asar.extractFile(ASAR, name).toString('utf8'); break; } catch { /* try next */ }
}
note(/contextIsolation:\s*true/.test(mainCjs), 'main.cjs bật contextIsolation');
note(/nodeIntegration:\s*false/.test(mainCjs), 'main.cjs tắt nodeIntegration');
note(/devTools:\s*(!app\.isPackaged|false)/.test(mainCjs), 'main.cjs tắt DevTools khi đóng gói');

// 7. better-sqlite3 is the Windows (PE) binary — Node ABI 127, not the Electron ABI @electron/rebuild
//    would have produced, and not the macOS Mach-O.
let sqliteOk = false;
let sqliteWhat = 'thiếu file';
if (existsSync(SQLITE)) {
  const head = readFileSync(SQLITE).subarray(0, 4);
  const isPE = head[0] === 0x4d && head[1] === 0x5a; // 'MZ'
  const isMachO = head[0] === 0xcf && head[1] === 0xfa; // 0xcffaedfe little-endian
  const isELF = head[0] === 0x7f && head[1] === 0x45; // 0x7f 'E'
  sqliteOk = isPE && !isMachO && !isELF;
  sqliteWhat = isPE ? 'PE/Windows' : isMachO ? 'Mach-O/macOS (SAI)' : isELF ? 'ELF/Linux (SAI)' : 'không nhận dạng';
}
note(sqliteOk, 'better_sqlite3.node là binary Windows', sqliteWhat);

// 7b. The Agent Kit travels with the app, readable and keyless — the one part meant to be read.
const KIT = join(PAYLOAD, 'packages', 'avs-kit');
const kitFiles = walk(KIT);
note(existsSync(join(KIT, 'bin', 'avs-mcp.mjs')), 'Agent Kit có mặt trong payload', `${kitFiles.length} file`);
const kitHex = kitFiles.filter((f) => /[0-9a-f]{64}/i.test(readFileSync(f, 'utf8')));
note(kitHex.length === 0, 'kit không chứa khoá 64-hex', kitHex.map((f) => f.slice(KIT.length + 1)).join(', '));

// 8. The AES key lives ONLY in the launcher. It must not have leaked into readable JS or the meta.
//    (app.jsc.json.sha256 is a legitimate 64-hex value, so the meta is checked by field, not by
//    scanning for hex.)
const hex64 = /[0-9a-f]{64}/i;
const keyTokens = /appkey|app_key/i;
const mainClean = mainCjs && !hex64.test(mainCjs) && !keyTokens.test(mainCjs);
note(Boolean(mainClean), 'main.cjs không chứa khoá', mainCjs ? '' : 'không đọc được main.cjs');
const metaClean = meta && !('key' in meta) && !Object.keys(meta).some((k) => keyTokens.test(k));
note(Boolean(metaClean), 'app.jsc.json không chứa khoá');

console.log();
if (failures.length) {
  console.error(`✖ Bản Windows KHÔNG đạt: ${failures.length} mục — ${failures.join('; ')}\n`);
  process.exit(1);
}
console.log(`✅ Bản Windows kín: ${scanned} file đã quét, không có mã nguồn, doctrine hay khoá nào đọc được.\n`);
