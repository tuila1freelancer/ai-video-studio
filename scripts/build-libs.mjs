#!/usr/bin/env node
// Provision the CREATIVE RUNTIME LIBRARIES the scene codegen may reach for (P40).
//
// The codegen model may use three.js / p5.js / tsParticles / countUp on top of GSAP. The
// renderer must stay offline and deterministic, so these libraries are VENDORED here instead of
// fetched per render, and the harness injects only
// the ones a scene actually references.
//
//   node scripts/build-libs.mjs          # fetch anything missing into vendor/libs/
//   node scripts/build-libs.mjs --force  # re-fetch everything
//
// vendor/ is gitignored — this script is the reproducible provisioning step (same shape as
// scripts/build-fonts.mjs). A missing library is never fatal: the harness simply omits it
// and the codegen prompt stops advertising it.
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'libs');

// GSAP plugin versions track vendor/gsap (3.13.0) so core and plugin never disagree.
const LIBS = [
  { file: 'three.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', min: 400_000 },
  { file: 'p5.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js', min: 700_000 },
  { file: 'countUp.umd.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/countup.js/2.8.0/countUp.umd.js', min: 3_000 },
  { file: 'tsparticles.slim.bundle.min.js', url: 'https://cdn.jsdelivr.net/npm/tsparticles-slim@2.12.0/tsparticles.slim.bundle.min.js', min: 80_000 },
  { file: 'ScrollTrigger.min.js', url: 'https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js', min: 20_000 },
  { file: 'CSSRulePlugin.min.js', url: 'https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/CSSRulePlugin.min.js', min: 1_000 },
];

const force = process.argv.includes('--force');
mkdirSync(OUT, { recursive: true });

let fetched = 0, kept = 0, failed = 0;
for (const lib of LIBS) {
  const dest = join(OUT, lib.file);
  if (!force && existsSync(dest) && statSync(dest).size >= lib.min) { kept++; continue; }
  try {
    const res = await fetch(lib.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // A CDN error page is a 200 with a tiny body — refuse to vendor a truncated library.
    if (buf.length < lib.min) throw new Error(`suspiciously small (${buf.length} bytes)`);
    writeFileSync(dest, buf);
    console.log(`✔ ${lib.file} (${(buf.length / 1024).toFixed(0)} KB)`);
    fetched++;
  } catch (e) {
    console.error(`✖ ${lib.file}: ${e.message}`);
    failed++;
  }
}
console.log(`\n${fetched} fetched · ${kept} already present · ${failed} failed → ${OUT}`);
if (failed && !fetched && !kept) process.exit(1);
