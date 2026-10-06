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
console.log('· checking prerequisites…');
try { cap('go', ['version']); } catch { die('Go is not installed — Go 1.22+ is needed to build the Windows launcher.\n  Install: brew install go'); }
if (!existsSync(MAC_NODE)) die('vendor/node (macOS) is missing — run: npm run node:fetch');
const NODE_VER = cap(MAC_NODE, ['-v']); // e.g. v22.22.1 — the single source of truth for V8
console.log(`  project node: ${NODE_VER}`);

// ── 2. Vendored Windows node.exe (pinned to the mac node's version) ───────────────────────────────
if (!existsSync(WIN_NODE)) {
  console.log('· fetching the Windows node.exe…');
  run(MAC_NODE, [join(ROOT, 'scripts', 'fetch-node.mjs'), '--win']);
}
if (!existsSync(WIN_NODE)) die('could not fetch vendor/node-win/node.exe');

// ── 3–5. Bundle → bytecode → encrypt (with a fresh per-build key) ─────────────────────────────────
// maxRetries: the external SSD occasionally throws ENOTEMPTY on a recursive remove mid-flight.
rmSync(PAYLOAD, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(PAYLOAD, { recursive: true });
console.log('· bundle src → server.cjs…');
run(MAC_NODE, [join(ROOT, 'scripts', 'build-bundle.mjs'), '--out', PAYLOAD, '--map-out', join(ROOT, 'dist', 'private')]);

const APP_KEY = randomBytes(32).toString('hex'); // in RAM only until it is compiled into the launcher
console.log('· compiling bytecode + encrypting…');
run(MAC_NODE, [join(ROOT, 'scripts', 'build-bytecode.mjs'), '--in', join(PAYLOAD, 'server.cjs'), '--out', PAYLOAD, '--key', APP_KEY]);
rmSync(join(PAYLOAD, 'server.cjs'), { force: true }); // the plaintext bundle never ships
for (const f of ['app.jsc', 'app.jsc.json', 'loader.cjs']) {
  if (!existsSync(join(PAYLOAD, f))) die(`bytecode is missing ${f}`);
}

// ── 6. Go launcher, with the key compiled in ─────────────────────────────────────────────────────
console.log('· building the Go launcher (key embedded)…');
run('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.appKey=${APP_KEY}`, '-o', LAUNCHER, '.'],
  { cwd: join(ROOT, 'shell', 'win-launcher'), env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' } });
if (!existsSync(LAUNCHER)) die('could not build avs-launcher.exe');

// ── 7. Frontend (minified UI + locales) ──────────────────────────────────────────────────────────
console.log('· building the frontend…');
run(MAC_NODE, [join(ROOT, 'scripts', 'build-frontend.mjs'), '--out', join(PAYLOAD, 'public')]);

// ── 8. Production deps, staged, then the Windows-ABI better-sqlite3 swapped in ────────────────────
console.log('· installing production dependencies…');
const stage = mkdtempSync(join(tmpdir(), 'avs-win-'));
copyFileSync(join(ROOT, 'package.json'), join(stage, 'package.json'));
copyFileSync(join(ROOT, 'package-lock.json'), join(stage, 'package-lock.json'));
// Lead PATH with the vendored node so better-sqlite3's `#!/usr/bin/env node` install script resolves
// to Node 22 (not an nvm Node 24), keeping the base install at the right ABI. The win32 prebuild
// below overwrites the binary anyway, but this keeps the staging tree consistent.
run(MAC_NODE, [MAC_NPM, 'ci', '--omit=dev', '--silent'],
  { cwd: stage, env: { ...process.env, PATH: `${join(ROOT, 'vendor', 'node', 'bin')}:${process.env.PATH}` } });
cpSync(join(stage, 'node_modules'), join(PAYLOAD, 'node_modules'), { recursive: true });
rmSync(stage, { recursive: true, force: true });

console.log('· swapping better-sqlite3 to the Node win-x64 ABI…');
const bsqlite = join(PAYLOAD, 'node_modules', 'better-sqlite3');
const version = NODE_VER.replace(/^v/, '');
run(join(ROOT, 'node_modules', '.bin', 'prebuild-install'),
  ['-r', 'node', '-t', version, '--arch', 'x64', '--platform', 'win32', '--tag-prefix', 'v'],
  { cwd: bsqlite });
const sqliteBin = join(bsqlite, 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(sqliteBin)) die('could not fetch better_sqlite3.node (win32-x64)');

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
if (!existsSync(join(ROOT, 'vendor', 'ffmpeg-win', 'ffmpeg.exe'))) {
  console.log('· fetching the Windows ffmpeg…');
  try { run(MAC_NODE, [join(ROOT, 'scripts', 'fetch-ffmpeg-win.mjs')]); } catch { /* fall through to warn */ }
}
if (existsSync(join(ROOT, 'vendor', 'ffmpeg-win', 'ffmpeg.exe'))) {
  cpSync(join(ROOT, 'vendor', 'ffmpeg-win'), join(PAYLOAD, 'vendor', 'ffmpeg'), { recursive: true });
  console.log('  ✓ bundled the Windows ffmpeg (libass)');
} else {
  console.warn('  ⚠ NO vendor/ffmpeg-win — the Windows build will need a system ffmpeg (C:\\ffmpeg\\bin or PATH); libass subtitles need the vendored ffmpeg. Run: npm run ffmpeg:fetch:win');
}

// ── 10b. The Agent Kit, shipped as readable source beside the sealed engine ──────────────────────
cpSync(join(ROOT, 'packages', 'avs-kit'), join(PAYLOAD, 'packages', 'avs-kit'), { recursive: true });

// ── 11. Scrub the payload (mirror scrub_payload in build-app.sh) ──────────────────────────────────
console.log('· cleaning the payload…');
scrub(PAYLOAD);

// ── 12. electron-builder with the protected config ───────────────────────────────────────────────
console.log('· electron-builder --win…');
run(join(ROOT, 'node_modules', '.bin', 'electron-builder'),
  ['--win', '--config', join(ROOT, 'electron-builder.win.cjs'), '--publish', 'never'],
  { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }); // unsigned on purpose

// ── 13. Audit (HARD GATE) ────────────────────────────────────────────────────────────────────────
// macOS keeps dropping .DS_Store onto the external volume even after the afterPack sweep; clear
// win-unpacked once more right before the scan (the installer was already packed clean in afterPack).
try { execFileSync('find', [join(ROOT, 'dist', 'electron', 'win-unpacked'), '-name', '.DS_Store', '-delete'], { stdio: 'ignore' }); } catch { /* best effort */ }
console.log('· auditing the Windows build…');
run(MAC_NODE, [join(ROOT, 'scripts', 'audit-windows.mjs'), '--dist', join(ROOT, 'dist', 'electron', 'win-unpacked')]);

console.log('\n✅ Done. The installer is in dist/electron/');
console.log('   ⚠ Required: smoke-test on a real Windows machine (the V8 cache and better-sqlite3 are only proven by running).');

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
