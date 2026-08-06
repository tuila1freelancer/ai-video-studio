#!/usr/bin/env node
// Fetch a PORTABLE Node runtime into vendor/node, for the distributable bundle.
//
// The Homebrew `node` on this machine is an 84 KB stub that links a dozen dylibs out of
// /opt/homebrew. Copying it into an .app produces a bundle that runs perfectly here and crashes
// on the first customer's Mac — the failure a build machine is least likely to notice.
//
// The official nodejs.org tarball is fully self-contained, so that is what ships. Downloaded once,
// verified against the release's own SHASUMS256, and cached in vendor/ (git-ignored).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = process.env.AVS_NODE_VERSION || process.version.replace(/^v/, '');
const ARCH = process.env.AVS_NODE_ARCH || (process.arch === 'x64' ? 'x64' : 'arm64');
const NAME = `node-v${VERSION}-darwin-${ARCH}`;
const DEST = join(ROOT, 'vendor', 'node');
const BIN = join(DEST, 'bin', 'node');

if (existsSync(BIN) && !process.argv.includes('--force')) {
  const have = execFileSync(BIN, ['-v'], { encoding: 'utf8' }).trim();
  if (have === `v${VERSION}`) {
    console.log(`vendor/node đã có ${have} — bỏ qua (dùng --force để tải lại)`);
    process.exit(0);
  }
}

const base = `https://nodejs.org/dist/v${VERSION}`;
console.log(`tải ${NAME}.tar.gz …`);

const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith(`  ${NAME}.tar.gz`))?.split(/\s+/)[0];
if (!expected) {
  console.error(`✖ không tìm thấy ${NAME}.tar.gz trong SHASUMS256 của v${VERSION}`);
  process.exit(1);
}

const res = await fetch(`${base}/${NAME}.tar.gz`);
if (!res.ok) {
  console.error(`✖ tải thất bại: HTTP ${res.status}`);
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== expected) {
  // A runtime is the most dangerous thing to install unverified: it executes everything else.
  console.error(`✖ checksum sai\n   chờ đợi: ${expected}\n   nhận:    ${actual}`);
  process.exit(1);
}

mkdirSync(join(ROOT, 'vendor'), { recursive: true });
const tmp = join(ROOT, 'vendor', `${NAME}.tar.gz`);
writeFileSync(tmp, bytes);
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
execFileSync('/usr/bin/tar', ['-xzf', tmp, '-C', DEST, '--strip-components=1'], { stdio: 'inherit' });
rmSync(tmp, { force: true });

// Everything except the runtime itself is npm/npx/docs the bundle will never run.
for (const extra of ['share', 'include', 'lib/node_modules/corepack']) {
  rmSync(join(DEST, extra), { recursive: true, force: true });
}

const version = execFileSync(BIN, ['-v'], { encoding: 'utf8' }).trim();
console.log(`✅ vendor/node ${version} (${ARCH}) — checksum khớp`);
