#!/usr/bin/env node
// Audit what is INSIDE a built container image, not what the build script meant to put there.
//
//   node scripts/audit-image.mjs [--image avs:latest]
//
// Exports the image's filesystem and runs the payload audit over /app. A Dockerfile can be right
// and the image still wrong — a stale cached layer, a COPY that brought more than it said — and the
// only way to know is to look at the bytes that shipped.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};

const IMAGE = arg('image', 'avs:latest');
const work = mkdtempSync(join(tmpdir(), 'avs-image-audit-'));
const container = `avs-audit-${Date.now().toString(36)}`;

try {
  console.log(`· xuất ${IMAGE}…`);
  execFileSync('docker', ['create', '--name', container, IMAGE], { stdio: 'ignore' });
  // export | tar: the only way to read a layer's real contents without running the image.
  execFileSync('sh', ['-c', `docker export ${container} | tar -x -C ${work} app`], { stdio: 'inherit' });
  if (!existsSync(join(work, 'app', 'app-payload'))) {
    console.error(`✖ image không có /app/app-payload`);
    process.exit(1);
  }
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'audit-linux.mjs'), '--dist', join(work, 'app')], { stdio: 'inherit' });
} finally {
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); } catch { /* never created */ }
  rmSync(work, { recursive: true, force: true });
}
