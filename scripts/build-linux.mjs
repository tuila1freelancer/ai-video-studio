// Build the PROTECTED Linux server payload — the same chain as macOS and Windows, for a machine
// with no desktop.
//
//   node scripts/build-linux.mjs [--out dist/server-linux-x64]
//
// src/ is bundled → compiled to V8 bytecode → AES-256-GCM encrypted, and the key lives only inside
// a compiled Go launcher that hands it to the vendored node over stdin. What comes out is a
// directory: launcher, runtime, payload. The Dockerfile copies it; a bare VM can run it as it is.
//
// Written beside build-windows.mjs rather than inside shell/build-app.sh on purpose: that script's
// text is pinned by tests/release-payload.test.js, and a Linux branch in it would turn that red
// for a platform it says nothing about.
//
// Cross-compilation caveat, same as Windows: bytecode is compiled here by the macOS vendored node.
// V8 bytecode is architecture-neutral and process.versions.v8 is identical across a Node release's
// platform builds, and loader.cjs hard-rejects a mismatch — but only a real Linux boot proves it,
// which is what the Docker build and its smoke test are for.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
const cap = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};

const HOST_NODE = join(ROOT, 'vendor', 'node', 'bin', 'node');
const HOST_NPM = join(ROOT, 'vendor', 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const LINUX_NODE = join(ROOT, 'vendor', 'node-linux', 'bin', 'node');
const OUT = join(ROOT, arg('out', join('dist', 'server-linux-x64')));
const PAYLOAD = join(OUT, 'app-payload');

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── 1. Preconditions ───────────────────────────────────────────────────────────────────────────
console.log('· checking prerequisites…');
try { cap('go', ['version']); } catch { die('Go is not installed — Go 1.22+ is needed to build the launcher.\n  Install: brew install go'); }
if (!existsSync(HOST_NODE)) die('vendor/node is missing — run: npm run node:fetch');
const NODE_VER = cap(HOST_NODE, ['-v']); // the single source of truth for V8
console.log(`  project node: ${NODE_VER}`);

// ── 2. Vendored Linux runtime, pinned to the same version ────────────────────────────────────────
if (!existsSync(LINUX_NODE)) {
  console.log('· fetching the Linux node runtime…');
  run(HOST_NODE, [join(ROOT, 'scripts', 'fetch-node.mjs'), '--linux']);
}
if (!existsSync(LINUX_NODE)) die('could not fetch vendor/node-linux/bin/node');

// ── 3–5. Bundle → bytecode → encrypt (fresh per-build key) ───────────────────────────────────────
rmSync(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(PAYLOAD, { recursive: true });
console.log('· bundle src → server.cjs…');
run(HOST_NODE, [join(ROOT, 'scripts', 'build-bundle.mjs'), '--out', PAYLOAD, '--map-out', join(ROOT, 'dist', 'private')]);

const APP_KEY = process.env.AVS_APP_KEY || randomBytes(32).toString('hex'); // RAM only, until it is compiled in
console.log('· compiling bytecode + encrypting…');
run(HOST_NODE, [join(ROOT, 'scripts', 'build-bytecode.mjs'), '--in', join(PAYLOAD, 'server.cjs'), '--out', PAYLOAD, '--key', APP_KEY]);
rmSync(join(PAYLOAD, 'server.cjs'), { force: true }); // the plaintext bundle never ships
for (const f of ['app.jsc', 'app.jsc.json', 'loader.cjs']) {
  if (!existsSync(join(PAYLOAD, f))) die(`bytecode is missing ${f}`);
}

// ── 6. Go launcher, with the key compiled in ─────────────────────────────────────────────────────
// The same source as the Windows launcher: job_other.go is already the non-Windows stub, and the
// paths it resolves (./node-*/bin/node, ./app-payload) are the layout this script writes.
console.log('· building the Go launcher (key embedded)…');
const LAUNCHER = join(OUT, 'avs-launcher');
// nodeRel: the Windows default points at node-win/node.exe, which is not where a Linux payload
// keeps its runtime. One source, three layouts, each named at build time.
run('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.appKey=${APP_KEY} -X main.nodeRel=node-linux/bin/node`, '-o', LAUNCHER, '.'],
  { cwd: join(ROOT, 'shell', 'win-launcher'), env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' } });
if (!existsSync(LAUNCHER)) die('could not build avs-launcher');
chmodSync(LAUNCHER, 0o755);

// ── 7. Frontend ──────────────────────────────────────────────────────────────────────────────────
console.log('· building the frontend…');
run(HOST_NODE, [join(ROOT, 'scripts', 'build-frontend.mjs'), '--out', join(PAYLOAD, 'public')]);

// ── 8. Production deps, then the linux-x64 better-sqlite3 swapped in ─────────────────────────────
console.log('· installing production dependencies…');
const stage = mkdtempSync(join(tmpdir(), 'avs-linux-'));
copyFileSync(join(ROOT, 'package.json'), join(stage, 'package.json'));
copyFileSync(join(ROOT, 'package-lock.json'), join(stage, 'package-lock.json'));
run(HOST_NODE, [HOST_NPM, 'ci', '--omit=dev', '--silent'],
  { cwd: stage, env: { ...process.env, PATH: `${join(ROOT, 'vendor', 'node', 'bin')}:${process.env.PATH}` } });
cpSync(join(stage, 'node_modules'), join(PAYLOAD, 'node_modules'), { recursive: true });
rmSync(stage, { recursive: true, force: true });

console.log('· swapping better-sqlite3 to the Node linux-x64 ABI…');
const bsqlite = join(PAYLOAD, 'node_modules', 'better-sqlite3');
run(join(ROOT, 'node_modules', '.bin', 'prebuild-install'),
  ['-r', 'node', '-t', NODE_VER.replace(/^v/, ''), '--arch', 'x64', '--platform', 'linux', '--tag-prefix', 'v'],
  { cwd: bsqlite });
if (!existsSync(join(bsqlite, 'build', 'Release', 'better_sqlite3.node'))) die('could not fetch better_sqlite3.node (linux-x64)');

// ── 9. package.json + lock so the server's ROOT resolves ─────────────────────────────────────────
copyFileSync(join(ROOT, 'package.json'), join(PAYLOAD, 'package.json'));
copyFileSync(join(ROOT, 'package-lock.json'), join(PAYLOAD, 'package-lock.json'));

// ── 10. Runtime + vendor data. No ffmpeg and no Chrome: a Linux image installs both from its own
//        package manager, and AVS_FFMPEG / AVS_CHROME point at them. ─────────────────────────────
cpSync(join(ROOT, 'vendor', 'node-linux'), join(OUT, 'node-linux'), { recursive: true });
mkdirSync(join(PAYLOAD, 'vendor'), { recursive: true });
for (const v of ['gsap', 'libs', 'fonts']) {
  if (existsSync(join(ROOT, 'vendor', v))) cpSync(join(ROOT, 'vendor', v), join(PAYLOAD, 'vendor', v), { recursive: true });
}

// ── 11. Scrub (mirror scrub_payload in build-app.sh) ─────────────────────────────────────────────
console.log('· cleaning the payload…');
scrub(OUT);

// ── 12. Audit (HARD GATE) ────────────────────────────────────────────────────────────────────────
console.log('· audit payload…');
run(HOST_NODE, [join(ROOT, 'scripts', 'audit-linux.mjs'), '--dist', OUT]);

console.log(`\n✅ Xong: ${OUT}`);
console.log('   Run: ./avs-launcher   (AVS_MODE=server AVS_HOST=0.0.0.0 AVS_DATA_DIR=/data …)');
console.log('   ⚠ Bytecode was compiled on macOS for Linux — a real boot smoke test is required (docker build/run).');

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
function scrub(dir) {
  const del = ['.DS_Store', '*.map', '*.ts', '*.flow', '*.test.js', '*.spec.js', '.npmignore', '.travis.yml', '.eslintrc*', '.editorconfig'];
  try {
    execFileSync('find', [dir, '(', ...del.flatMap((p, i) => (i ? ['-o', '-name', p] : ['-name', p])), ')', '-type', 'f', '-delete'], { stdio: 'ignore' });
  } catch { /* best effort */ }
  try {
    execFileSync('find', [dir, '-type', 'f', '(', '-iname', '*.md', '-o', '-iname', '*.markdown', ')', '!', '-iname', '*licen[cs]e*', '!', '-iname', 'copying*', '!', '-iname', 'notice*', '-delete'], { stdio: 'ignore' });
  } catch { /* best effort */ }
  try {
    execFileSync('find', [dir, '-type', 'd', '(', '-name', 'test', '-o', '-name', 'tests', '-o', '-name', '__tests__', '-o', '-name', 'example', '-o', '-name', 'examples', ')', '-prune', '-exec', 'rm', '-rf', '{}', '+'], { stdio: 'ignore' });
  } catch { /* best effort */ }
}
