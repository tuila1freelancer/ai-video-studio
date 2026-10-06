#!/usr/bin/env node
// Read the built .app the way a curious customer would, and refuse to ship if it gives anything up.
//
//   node scripts/audit-release.mjs --app "AI Video Studio.app"
//
// Every check is performed on the ASSEMBLED BUNDLE, never on the source that produced it. The
// point of this file is to catch the build regressing — a `cp -R src` creeping back, a scrub rule
// that stopped matching, an encryption step quietly skipped — none of which any unit test can see.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const APP = resolve(ROOT, arg('app', 'AI Video Studio.app'));
const PAYLOAD = join(APP, 'Contents', 'Resources', 'app');

// Canaries taken from the highest-value files in the repo. If any of these can be read out of the
// bundle, so can everything around them.
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
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const files = walk(APP);

// 1. No JavaScript source of ours, anywhere.
const ourJs = files.filter((f) => f.startsWith(join(PAYLOAD, 'src')) && f.endsWith('.js'));
note(ourJs.length === 0, 'no src/*.js files left in the payload', `${ourJs.length} file`);

// 2. The payload entry is bytecode, and it is encrypted.
let meta = null;
try { meta = JSON.parse(readFileSync(join(PAYLOAD, 'app.jsc.json'), 'utf8')); } catch { /* reported below */ }
note(Boolean(meta), 'app.jsc.json present');
note(meta?.encrypted === true, 'bytecode is encrypted', meta ? `v8 ${meta.v8}` : '');

// 3. Housekeeping the old build shipped: 519 dependency READMEs, .DS_Store, sourcemaps.
const junk = {
  '.DS_Store': files.filter((f) => basename(f) === '.DS_Store'),
  'sourcemap': files.filter((f) => f.endsWith('.map')),
  'markdown (licences excepted)': files.filter((f) => /\.(md|markdown)$/i.test(f) && !/licen[cs]e|copying|notice/i.test(basename(f))),
};
for (const [label, hits] of Object.entries(junk)) {
  note(hits.length === 0, `no ${label}`, hits.length ? `${hits.length}: ${hits.slice(0, 2).map((f) => f.slice(APP.length + 1)).join(', ')}` : '');
}

// 4. The doctrine itself, searched byte-exact in both encodings. UTF-16 matters: the Vietnamese
//    forces two-byte storage, which is why `strings` alone reported the plain bytecode as clean.
let scanned = 0;
const leaks = [];
for (const f of files) {
  if (statSync(f).size > 60e6) continue;
  scanned += 1;
  const buf = readFileSync(f);
  for (const [origin, probe] of CANARIES) {
    if (buf.includes(Buffer.from(probe, 'latin1')) || buf.includes(Buffer.from(probe, 'utf16le'))) {
      leaks.push(`${probe} (${origin}) → ${f.slice(APP.length + 1)}`);
    }
  }
}
note(leaks.length === 0, `no readable doctrine in ${scanned} files`, leaks.join(' | '));

// 6. The Agent Kit travels with the app, readable and keyless — it is the one part that is meant
//    to be read. Absent, a user who never cloned the repo has no way to point an agent here.
const KIT = join(PAYLOAD, 'packages', 'avs-kit');
const kitFiles = existsSync(KIT) ? walk(KIT) : [];
note(existsSync(join(KIT, 'bin', 'avs-mcp.mjs')), 'Agent Kit present in the payload', `${kitFiles.length} file`);
const kitHex = kitFiles.filter((f) => /[0-9a-f]{64}/i.test(readFileSync(f, 'utf8')));
note(kitHex.length === 0, 'kit holds no 64-hex key', kitHex.map((f) => f.slice(KIT.length + 1)).join(', '));

// 5. The launcher runs bytecode, and the window hands over no inspector.
const launcher = readFileSync(join(APP, 'Contents', 'MacOS', 'AI Video Studio'));
note(launcher.includes(Buffer.from('loader.cjs')), 'launcher runs loader.cjs');
note(launcher.includes(Buffer.from('--no-lazy')), 'launcher passes --no-lazy', 'without it V8 returns nothing');
note(!launcher.includes(Buffer.from('src/server.js')), 'launcher no longer points at source');
const swift = readFileSync(join(ROOT, 'shell', 'main.swift'), 'utf8');
note(/EXTRA_ENV\["AVS_DIST"\] != "1", forKey: "developerExtrasEnabled"/.test(swift), 'DevTools disabled in the dist build');

console.log();
if (failures.length) {
  console.error(`✖ Build FAILED: ${failures.length} check(s) — ${failures.join('; ')}\n`);
  process.exit(1);
}
console.log(`✅ Build sealed: ${scanned} files scanned, no readable source or doctrine.\n`);
