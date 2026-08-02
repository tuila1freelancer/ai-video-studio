#!/usr/bin/env node
// Provision a BIGGER whisper model (P40).
//
// Transcript quality is the ceiling of the edit-video lane: there is no script to align against,
// so whatever the recognizer hears becomes the scene's content. ggml-small mangles Vietnamese
// badly ("FAMO TANG NANG SUK" for "Ba mẹo tăng năng suất"); large-v3-turbo gets it right.
// config/paths.js already prefers the largest model present, so this script is the whole install.
//
//   node scripts/build-whisper-model.mjs                # large-v3-turbo, q5_0 (~570 MB)
//   node scripts/build-whisper-model.mjs large-v3       # full precision (~1.6 GB)
//   node scripts/build-whisper-model.mjs medium
//
// vendor/ is gitignored — nothing here lands in the repo.
import { createWriteStream, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'whisper', 'models');
const BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

// name → the file actually downloaded. Quantized turbo is the default: near-large accuracy at a
// third of the size and roughly large-v3 speed on Apple silicon.
const VARIANTS = {
  'large-v3-turbo': { remote: 'ggml-large-v3-turbo-q5_0.bin', min: 400_000_000 },
  'large-v3': { remote: 'ggml-large-v3.bin', min: 1_000_000_000 },
  medium: { remote: 'ggml-medium.bin', min: 900_000_000 },
  small: { remote: 'ggml-small.bin', min: 300_000_000 },
};

const want = process.argv[2] || 'large-v3-turbo';
const v = VARIANTS[want];
if (!v) {
  console.error(`unknown model "${want}" — pick one of: ${Object.keys(VARIANTS).join(', ')}`);
  process.exit(1);
}
// Saved under the canonical name so paths.js's largest-first search finds it.
const dest = join(OUT, `ggml-${want}.bin`);
if (existsSync(dest) && statSync(dest).size >= v.min) {
  console.log(`✔ ${dest} already present (${(statSync(dest).size / 1e6).toFixed(0)} MB)`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const url = `${BASE}/${v.remote}`;
const tmp = `${dest}.part`;
console.log(`↓ ${url}`);
const res = await fetch(url);
if (!res.ok) { console.error(`✖ HTTP ${res.status}`); process.exit(1); }
const totalBytes = Number(res.headers.get('content-length')) || 0;
let seen = 0, lastPct = -5;
const body = Readable.fromWeb(res.body);
body.on('data', (c) => {
  seen += c.length;
  const pct = totalBytes ? Math.floor((seen / totalBytes) * 100) : 0;
  if (pct - lastPct >= 5) { lastPct = pct; process.stdout.write(`\r  ${pct}% (${(seen / 1e6).toFixed(0)} MB)`); }
});
await pipeline(body, createWriteStream(tmp));
process.stdout.write('\n');
if (statSync(tmp).size < v.min) {
  unlinkSync(tmp);
  console.error('✖ download truncated');
  process.exit(1);
}
renameSync(tmp, dest);
console.log(`✔ ${dest} (${(statSync(dest).size / 1e6).toFixed(0)} MB) — restart the server to pick it up`);
