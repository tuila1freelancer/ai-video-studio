#!/usr/bin/env node
// Fetch a static Windows ffmpeg (with libass) into vendor/ffmpeg-win/, for the Windows bundle.
//
// The macOS vendor/ffmpeg is a darwin binary from evermeet.cx — useless on Windows, which looks for
// ffmpeg.exe. build-windows.mjs ships vendor/ffmpeg-win/ into the payload so a customer needs no
// system ffmpeg, and so libass subtitles work (paths.js's ffmpegAss has no system fallback).
//
// Pinned to a BtbN GPL build — the GPL config is what includes libass — matching the macOS ffmpeg's
// major version (8.1). Verified against BtbN's published sha256. vendor/ is git-ignored, so only this
// script is committed; re-run it on a fresh checkout.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'vendor', 'ffmpeg-win');
const FORCE = process.argv.includes('--force');

// BtbN FFmpeg-Builds, pinned dated release. GPL → libass; 8.1.x matches the macOS vendor ffmpeg.
const NAME = 'ffmpeg-n8.1.2-50-g1a748fe2cd-win64-gpl-8.1';
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-04-14-01/${NAME}.zip`;
const SHA256 = 'b8481cf0b9c93cf15fadf70217ba379dd8aef2fa6d08c0abab1037af10a38d8a';

if (existsSync(join(DEST, 'ffmpeg.exe')) && existsSync(join(DEST, 'ffprobe.exe')) && !FORCE) {
  console.log('vendor/ffmpeg-win already has ffmpeg.exe + ffprobe.exe — skipping (use --force to download again)');
  process.exit(0);
}

console.log(`downloading ${NAME}.zip (~168 MB) …`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`✖ download failed: HTTP ${res.status}`);
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== SHA256) {
  // ffmpeg runs untrusted media; an unverified binary is not worth the risk.
  console.error(`✖ checksum mismatch\n   expected: ${SHA256}\n   got:      ${actual}`);
  process.exit(1);
}

mkdirSync(join(ROOT, 'vendor'), { recursive: true });
const tmp = join(ROOT, 'vendor', `${NAME}.zip`);
writeFileSync(tmp, bytes);
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
// The zip nests everything under <NAME>/bin/. Take only ffmpeg.exe + ffprobe.exe (ffplay is dead
// weight), flattened (-j) into vendor/ffmpeg-win.
execFileSync('/usr/bin/unzip', ['-j', '-o', tmp, `${NAME}/bin/ffmpeg.exe`, `${NAME}/bin/ffprobe.exe`, '-d', DEST], { stdio: 'inherit' });
rmSync(tmp, { force: true });

const { statSync } = await import('node:fs');
for (const f of ['ffmpeg.exe', 'ffprobe.exe']) {
  if (!existsSync(join(DEST, f))) {
    console.error(`✖ ${f} missing after extraction`);
    process.exit(1);
  }
  const mb = (statSync(join(DEST, f)).size / 1e6).toFixed(1);
  console.log(`  ✓ ${f} (${mb} MB)`);
}
console.log(`✅ vendor/ffmpeg-win (ffmpeg 8.1.2 GPL/libass, win-x64) — checksum verified`);
