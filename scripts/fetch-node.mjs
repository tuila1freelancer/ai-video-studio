#!/usr/bin/env node
// Fetch a PORTABLE Node runtime into vendor/, for the distributable bundles.
//
// The Homebrew `node` on this machine is an 84 KB stub that links a dozen dylibs out of
// /opt/homebrew. Copying it into an .app produces a bundle that runs perfectly here and crashes
// on the first customer's Mac — the failure a build machine is least likely to notice.
//
// The official nodejs.org distributables are fully self-contained, so that is what ships. Downloaded
// once, verified against the release's own SHASUMS256, and cached in vendor/ (git-ignored).
//
//   node scripts/fetch-node.mjs          → vendor/node     (macOS, darwin-<arch>, the launch runtime)
//   node scripts/fetch-node.mjs --win    → vendor/node-win (Windows, win-x64/node.exe)
//
// The Windows runtime is PINNED to the macOS vendor node's exact version, because the release
// bytecode's V8 is recorded from that node and loader.cjs hard-rejects a V8 mismatch — the two must
// never drift apart.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.argv.includes('--win') || process.env.AVS_NODE_TARGET === 'win';
// A Linux server payload needs a Linux runtime, pinned to the same version as the macOS one for the
// same reason --win is: the bytecode is compiled by that V8 and the loader refuses any other.
const LINUX = process.argv.includes('--linux') || process.env.AVS_NODE_TARGET === 'linux';
const FORCE = process.argv.includes('--force');

// The macOS vendor node is the single source of truth for the version. For --win, pin to it so the
// Windows runtime's V8 matches the bytecode compiled by the macOS node.
const MAC_BIN = join(ROOT, 'vendor', 'node', 'bin', 'node');
function pinnedVersion() {
  if (existsSync(MAC_BIN)) {
    try {
      return execFileSync(MAC_BIN, ['-v'], { encoding: 'utf8' }).trim().replace(/^v/, '');
    } catch { /* fall through to env/process */ }
  }
  return process.env.AVS_NODE_VERSION || process.version.replace(/^v/, '');
}

const VERSION = WIN || LINUX ? pinnedVersion() : (process.env.AVS_NODE_VERSION || process.version.replace(/^v/, ''));
const ARCH = process.env.AVS_NODE_ARCH || (process.arch === 'x64' ? 'x64' : 'arm64');

const LINUX_ARCH = process.env.AVS_NODE_ARCH || 'x64';
const target = WIN
  ? { name: `node-v${VERSION}-win-x64`, ext: 'zip', dest: join(ROOT, 'vendor', 'node-win'), bin: join(ROOT, 'vendor', 'node-win', 'node.exe') }
  : LINUX
    ? { name: `node-v${VERSION}-linux-${LINUX_ARCH}`, ext: 'tar.xz', dest: join(ROOT, 'vendor', 'node-linux'), bin: join(ROOT, 'vendor', 'node-linux', 'bin', 'node') }
    : { name: `node-v${VERSION}-darwin-${ARCH}`, ext: 'tar.gz', dest: join(ROOT, 'vendor', 'node'), bin: join(ROOT, 'vendor', 'node', 'bin', 'node') };

if (existsSync(target.bin) && !FORCE) {
  if (WIN || LINUX) {
    // A foreign binary cannot be run here to check its version, so existence is the skip signal.
    console.log(`${target.dest.replace(ROOT + '/', '')} already has a runtime — skipping (use --force to download again)`);
    process.exit(0);
  }
  const have = execFileSync(target.bin, ['-v'], { encoding: 'utf8' }).trim();
  if (have === `v${VERSION}`) {
    console.log(`vendor/node already has ${have} — skipping (use --force to download again)`);
    process.exit(0);
  }
}

const base = `https://nodejs.org/dist/v${VERSION}`;
const file = `${target.name}.${target.ext}`;
console.log(`downloading ${file} …`);

const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
if (!expected) {
  console.error(`✖ ${file} not found in the SHASUMS256 of v${VERSION}`);
  process.exit(1);
}

const res = await fetch(`${base}/${file}`);
if (!res.ok) {
  console.error(`✖ download failed: HTTP ${res.status}`);
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== expected) {
  // A runtime is the most dangerous thing to install unverified: it executes everything else.
  console.error(`✖ checksum mismatch\n   expected: ${expected}\n   got:      ${actual}`);
  process.exit(1);
}

mkdirSync(join(ROOT, 'vendor'), { recursive: true });
const tmp = join(ROOT, 'vendor', file);
writeFileSync(tmp, bytes);
rmSync(target.dest, { recursive: true, force: true });
mkdirSync(target.dest, { recursive: true });

if (WIN) {
  // The zip carries node.exe (full ICU baked in) plus npm/npx the bundle never runs. Take only the
  // exe, flattened (-j) into vendor/node-win. -o overwrites without prompting.
  execFileSync('/usr/bin/unzip', ['-j', '-o', tmp, `${target.name}/node.exe`, '-d', target.dest], { stdio: 'inherit' });
} else {
  // Linux builds ship as .tar.xz, macOS as .tar.gz — the flag has to follow the file, not the habit.
  execFileSync('/usr/bin/tar', [LINUX ? '-xJf' : '-xzf', tmp, '-C', target.dest, '--strip-components=1'], { stdio: 'inherit' });
  // Everything except the runtime itself is npm/npx/docs the bundle will never run.
  for (const extra of ['share', 'include', 'lib/node_modules/corepack']) {
    rmSync(join(target.dest, extra), { recursive: true, force: true });
  }
}
rmSync(tmp, { force: true });

if (WIN || LINUX) {
  // A foreign binary cannot be executed here to read its version back; the checksum above is what
  // proves it is the right one, and the loader refuses at boot if the V8 inside disagrees.
  const { statSync } = await import('node:fs');
  const mb = (statSync(target.bin).size / 1e6).toFixed(1);
  console.log(`✅ ${target.bin.replace(`${ROOT}/`, '')} (v${VERSION}, ${mb} MB) — checksum verified`);
} else {
  const version = execFileSync(target.bin, ['-v'], { encoding: 'utf8' }).trim();
  console.log(`✅ vendor/node ${version} (${ARCH}) — checksum verified`);
}
