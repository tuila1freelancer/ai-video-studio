#!/usr/bin/env node
// Scene-gate tool for data-story channels — lists every number drawn on a scene that the
// narration never speaks (fabricated chart points, invented percentages), so the brief can be
// fixed before TTS/render. Usage:
//   node scripts/number-audit.mjs <projectId>            (reads the app DB — AVS_DATA_DIR aware)
//   node scripts/number-audit.mjs <path/to/scenes.json>  ([{voice, props:{html}}] or {scenes:[…]})
// Exit code: 0 = every on-screen number is spoken (axis scaffold aside), 2 = unspoken numbers found.
import { readFileSync } from 'node:fs';
import { auditProjectNumbers } from '../src/content/number-audit.js';

const arg = process.argv[2];
if (!arg) { console.error('usage: node scripts/number-audit.mjs <projectId|scenes.json>'); process.exit(1); }

let scenes = [];
if (/\.json$/i.test(arg)) {
  const d = JSON.parse(readFileSync(arg, 'utf8'));
  scenes = Array.isArray(d) ? d : d.scenes || [];
} else {
  const DB = await import('../src/db/index.js');
  scenes = DB.getScenes(arg);
  if (!scenes.length) { console.error(`project ${arg} not found / has no scenes`); process.exit(1); }
}

const { scenes: rows, defects } = auditProjectNumbers(scenes);
console.log(`# Number audit — ${rows.length} scenes`);
for (const r of rows) {
  if (!r.unspoken.length && !r.scaffold.length && !r.elsewhere.length) continue;
  const parts = [];
  if (r.unspoken.length) parts.push(`UNSPOKEN ${r.unspoken.join(' ')}`);
  if (r.elsewhere.length) parts.push(`elsewhere-in-video ${r.elsewhere.join(' ')}`);
  if (r.scaffold.length) parts.push(`scaffold ${r.scaffold.join(' ')}`);
  console.log(`  scene ${String(r.idx + 1).padStart(4)}  ${parts.join('  |  ')}`);
}
console.log(defects ? `VERDICT: ${defects} unspoken number(s) — fix those briefs at the scene gate` : 'VERDICT: OK — every on-screen number is spoken');
process.exit(defects ? 2 : 0);
