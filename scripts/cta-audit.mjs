#!/usr/bin/env node
// P33 measurement tool — prints the CTA/farewell map of a script so before/after
// regenerations are provable. Usage:
//   node scripts/cta-audit.mjs <projectId>            (reads the app DB — AVS_DATA_DIR aware)
//   node scripts/cta-audit.mjs <path/to/scenes.json>  (factory format, {scenes:[{voice}]}, or an array)
// Exit code: 0 = within budget, 2 = CTA-discipline defects found.
import { readFileSync } from 'node:fs';
import { classifyCta, auditCtas } from '../src/content/cta-audit.js';

const arg = process.argv[2];
if (!arg) { console.error('usage: node scripts/cta-audit.mjs <projectId|scenes.json>'); process.exit(1); }

let texts = [];
if (/\.json$/i.test(arg)) {
  const d = JSON.parse(readFileSync(arg, 'utf8'));
  const arr = Array.isArray(d) ? d : d.scenes || d.script || [];
  texts = arr.map((s) => String(s?.voice ?? s?.voice_text ?? s?.text ?? ''));
} else {
  const DB = await import('../src/db/index.js');
  const scenes = DB.getScenes(arg);
  if (!scenes.length) { console.error(`project ${arg} not found / has no scenes`); process.exit(1); }
  texts = scenes.map((s) => String(s.voice_text || ''));
}

const n = texts.length;
console.log(`# CTA audit — ${n} scenes`);
let hits = 0;
texts.forEach((t, i) => {
  const c = classifyCta(t);
  if (!c.cta && !c.farewell) return;
  hits++;
  const pos = (((i + 1) / n) * 100).toFixed(0).padStart(3);
  console.log(`  scene ${String(i + 1).padStart(4)} (${pos}%)  ${c.farewell ? 'FAREWELL' : 'CTA     '}  ${c.phrases.join(' | ').slice(0, 110)}`);
});
if (!hits) console.log('  (no CTA/farewell phrases at all)');
const { defects } = auditCtas(texts);
if (!defects.length) {
  console.log('VERDICT: OK — ≤1 soft CTA mid-video + closing CTA, no mid-video farewell');
} else {
  console.log('VERDICT: DEFECTS');
  for (const d of defects) console.log(`  - ${d.code} @ scenes ${d.idx.map((i) => i + 1).join(', ')}: ${d.detail}`);
  process.exitCode = 2;
}
