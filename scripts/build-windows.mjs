// Build the PROTECTED Windows installer from macOS — parity with the macOS release's protection.
//
// The old Windows build packed raw src/** into an asar (readable with `npx asar extract`). This one
// mirrors shell/build-app.sh --dist: src/ is bundled → compiled to V8 bytecode → AES-256-GCM
// encrypted, and the key lives only inside a compiled Go launcher that hands it to the vendored
// node.exe over stdin. electron-builder (electron-builder.win.cjs) then ships only a thin Electron
// main process in the asar, with the bytecode payload + node.exe + launcher as extraResources.
//
// The one thing this machine CANNOT prove: bytecode compiled on darwin-arm64 running on win-x64. V8
// bytecode is architecture-neutral and process.versions.v8 is identical across a Node version's
// platform builds, so it should load — loader.cjs hard-rejects if not — but a real Windows boot
// smoke test stays a release gate (see the plan).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();

const MAC_NODE = join(ROOT, 'vendor', 'node', 'bin', 'node');
const MAC_NPM = join(ROOT, 'vendor', 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const WIN_NODE = join(ROOT, 'vendor', 'node-win', 'node.exe');
const PAYLOAD = join(ROOT, 'shell', 'build', 'win-payload');
const LAUNCHER = join(ROOT, 'shell', 'build', 'avs-launcher.exe');

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── 1. Preconditions ───────────────────────────────────────────────────────────────────────────
console.log('· kiểm tra điều kiện…');
try { cap('go', ['version']); } catch { die('chưa cài Go — cần Go 1.22+ để dựng launcher Windows.\n  Cài: brew install go'); }
if (!existsSync(MAC_NODE)) die('thiếu vendor/node (macOS) — chạy: npm run node:fetch');
const NODE_VER = cap(MAC_NODE, ['-v']); // e.g. v22.22.1 — the single source of truth for V8
console.log(`  node dự án: ${NODE_VER}`);

// ── 2. Vendored Windows node.exe (pinned to the mac node's version) ───────────────────────────────
if (!existsSync(WIN_NODE)) {
  console.log('· tải node.exe Windows…');
  run(MAC_NODE, [join(ROOT, 'scripts', 'fetch-node.mjs'), '--win']);
}
if (!existsSync(WIN_NODE)) die('không lấy được vendor/node-win/node.exe');

// ── 3–5. Bundle → bytecode → encrypt (with a fresh per-build key) ─────────────────────────────────
rmSync(PAYLOAD, { recursive: true, force: true });
mkdirSync(PAYLOAD, { recursive: true });
console.log('· bundle src → server.cjs…');
run(MAC_NODE, [join(ROOT, 'scripts', 'build-bundle.mjs'), '--out', PAYLOAD, '--map-out', join(ROOT, 'dist', 'private')]);

const APP_KEY = randomBytes(32).toString('hex'); // in RAM only until it is compiled into the launcher
console.log('· biên dịch bytecode + mã hoá…');
run(MAC_NODE, [join(ROOT, 'scripts', 'build-bytecode.mjs'), '--in', join(PAYLOAD, 'server.cjs'), '--out', PAYLOAD, '--key', APP_KEY]);
rmSync(join(PAYLOAD, 'server.cjs'), { force: true }); // the plaintext bundle never ships
for (const f of ['app.jsc', 'app.jsc.json', 'loader.cjs']) {
  if (!existsSync(join(PAYLOAD, f))) die(`bytecode thiếu ${f}`);
}

// ── 6. Go launcher, with the key compiled in ─────────────────────────────────────────────────────
console.log('· dựng launcher Go (nhúng khoá)…');
run('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.appKey=${APP_KEY}`, '-o', LAUNCHER, '.'],
  { cwd: join(ROOT, 'shell', 'win-launcher'), env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } });
if (!existsSync(LAUNCHER)) die('không dựng được avs-launcher.exe');

// ── 7. Frontend (minified UI + locales) ──────────────────────────────────────────────────────────
console.log('· dựng frontend…');
run(MAC_NODE, [join(ROOT, 'scripts', 'build-frontend.mjs'), '--out', join(PAYLOAD, 'public')]);

// ── 8. Production deps, staged, then the Windows-ABI better-sqlite3 swapped in ────────────────────
console.log('· cài dependencies production…');
const stage = mkdtempSync(join(tmpdir(), 'avs-win-'));
copyFileSync(join(ROOT, 'package.json'), join(stage, 'package.json'));
copyFileSync(join(ROOT, 'package-lock.json'), join(stage, 'package-lock.json'));
run(MAC_NODE, [MAC_NPM, 'ci', '--omit=dev', '--silent'], { cwd: stage });
cpSync(join(stage, 'node_modules'), join(PAYLOAD, 'node_modules'), { recursive: true });
rmSync(stage, { recursive: true, force: true });

console.log('· hoán better-sqlite3 sang ABI Node-win-x64…');
const bsqlite = join(PAYLOAD, 'node_modules', 'better-sqlite3');
const version = NODE_VER.replace(/^v/, '');
run(join(ROOT, 'node_modules', '.bin', 'prebuild-install'),
  ['-r', 'node', '-t', version, '--arch', 'x64', '--platform', 'win32', '--tag-prefix', 'v'],
  { cwd: bsqlite });
const sqliteBin = join(bsqlite, 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(sqliteBin)) die('không lấy được better_sqlite3.node (win32-x64)');

// ── 9. package.json + lock so the server's ROOT resolves ─────────────────────────────────────────
copyFileSync(join(ROOT, 'package.json'), join(PAYLOAD, 'package.json'));
copyFileSync(join(ROOT, 'package-lock.json'), join(PAYLOAD, 'package-lock.json'));

// ── 10. vendor data (platform-agnostic). ffmpeg is NOT copied from vendor/ (those are macOS
//        binaries; Windows looks for ffmpeg.exe). Ship a Windows ffmpeg in vendor/ffmpeg-win, or the
//        app falls back to a system ffmpeg (C:\ffmpeg\bin or PATH). ────────────────────────────────
mkdirSync(join(PAYLOAD, 'vendor'), { recursive: true });
for (const v of ['gsap', 'libs', 'fonts']) {
  if (existsSync(join(ROOT, 'vendor', v))) cpSync(join(ROOT, 'vendor', v), join(PAYLOAD, 'vendor', v), { recursive: true });
}
if (existsSync(join(ROOT, 'vendor', 'ffmpeg-win'))) {
  cpSync(join(ROOT, 'vendor', 'ffmpeg-win'), join(PAYLOAD, 'vendor', 'ffmpeg'), { recursive: true });
  console.log('  ✓ đã đóng ffmpeg Windows');
} else {
  console.warn('  ⚠ KHÔNG có vendor/ffmpeg-win — bản Windows sẽ cần ffmpeg hệ thống (C:\\ffmpeg\\bin hoặc PATH) để render; phụ đề libass cần ffmpeg vendored.');
}

// ── 11. Scrub the payload (mirror scrub_payload in build-app.sh) ──────────────────────────────────
console.log('· dọn payload…');
scrub(PAYLOAD);

// ── 12. electron-builder with the protected config ───────────────────────────────────────────────
console.log('· electron-builder --win…');
run(join(ROOT, 'node_modules', '.bin', 'electron-builder'),
  ['--win', '--config', join(ROOT, 'electron-builder.win.cjs'), '--publish', 'never'],
  { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }); // unsigned on purpose

// ── 13. Audit (HARD GATE) ────────────────────────────────────────────────────────────────────────
console.log('· audit bản Windows…');
run(MAC_NODE, [join(ROOT, 'scripts', 'audit-windows.mjs'), '--dist', join(ROOT, 'dist', 'electron', 'win-unpacked')]);

console.log('\n✅ Xong. Bộ cài ở dist/electron/');
console.log('   ⚠ Bắt buộc: smoke-test trên Windows thật (V8 cache + better-sqlite3 chỉ chứng minh được khi chạy).');

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
function scrub(dir) {
  // find … -delete: the same set build-app.sh's scrub_payload removes. Best-effort.
  const del = ['.DS_Store', '*.map', '*.ts', '*.flow', '*.test.js', '*.spec.js', '.npmignore', '.travis.yml', '.eslintrc*', '.editorconfig'];
  try {
    execFileSync('find', [dir, '(', ...del.flatMap((p, i) => (i ? ['-o', '-name', p] : ['-name', p])), ')', '-type', 'f', '-delete'], { stdio: 'ignore' });
  } catch { /* best effort */ }
  try {
    execFileSync('find', [dir, '-type', 'f', '(', '-iname', '*.md', '-o', '-iname', '*.markdown', ')', '!', '-iname', '*licen[cs]e*', '!', '-iname', 'copying*', '!', '-iname', 'notice*', '-delete'], { stdio: 'ignore' });
  } catch { /* best effort */ }
  try {
    // .bin holds POSIX symlinks that break NSIS packaging on Windows and are never used at runtime
    // (the server requires packages directly), so it goes too.
    execFileSync('find', [dir, '-type', 'd', '(', '-name', 'test', '-o', '-name', 'tests', '-o', '-name', '__tests__', '-o', '-name', 'example', '-o', '-name', 'examples', '-o', '-name', '.bin', ')', '-prune', '-exec', 'rm', '-rf', '{}', '+'], { stdio: 'ignore' });
  } catch { /* best effort */ }
}
