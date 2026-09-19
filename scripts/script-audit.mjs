#!/usr/bin/env node
// Gate a narration script on the PROMPT MASTER v2 value contract before it goes into the app.
// Usage:
//   node scripts/script-audit.mjs <script.md> [--title "…"] [--prev <previous-script.md>] [--corpus <dir-of-video-folders>] [--wpm 171] [--min-words 1400]
// With --corpus, every other */script.md under that dir is compared for shared sentences; the
// most recently numbered sibling before this one is treated as the previous video when --prev is absent.
// Exit code: 0 = passes every measurable clause, 2 = defects listed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { auditScript } from '../src/content/script-audit.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && (args[args.indexOf(a) - 1] || '').startsWith('--') === false);
if (!file) { console.error('usage: node scripts/script-audit.mjs <script.md> [--title "…"] [--prev file] [--corpus dir]'); process.exit(1); }
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const text = readFileSync(file, 'utf8');
const corpusDir = opt('--corpus') || dirname(dirname(resolve(file)));
let corpus = [];
const me = resolve(file);
if (existsSync(corpusDir)) {
  const folders = readdirSync(corpusDir).filter((d) => existsSync(join(corpusDir, d, 'script.md'))).sort();
  const mine = basename(dirname(me));
  const others = folders.filter((d) => d !== mine);
  const prevName = opt('--prev') ? null : others.filter((d) => d < mine).pop();
  const ordered = prevName ? [prevName, ...others.filter((d) => d !== prevName)] : others;
  corpus = ordered.map((d) => readFileSync(join(corpusDir, d, 'script.md'), 'utf8'));
  if (!prevName && !opt('--prev')) corpus.unshift(''); // first video of the series: no previous to clash with
}
if (opt('--prev')) corpus.unshift(readFileSync(opt('--prev'), 'utf8'));

const r = auditScript(text, { title: opt('--title') || basename(dirname(me)).replace(/^\d+ - /, ''), corpus, wpm: +opt('--wpm') || 156, minWords: +opt('--min-words') || undefined });
console.log(`# Script audit — ${basename(dirname(me))} (${r.words} words ≈ ${r.minutes} min at the given pace · floor ${r.floor})`);
console.log(`  numbers ${r.numbers} (${r.per100}/100w) · sources spoken ${r.sourcesSpoken} · calc sentences ${r.workedExample} · checks ${r.checks} · mechanism named ${r.mechanismNamed ? 'yes' : 'no'}`);
console.log(`  answer at ${r.answerAt == null ? '—' : Math.round(r.answerAt * 100) + '%'} · title words in first 25%: ${r.titleCoverage == null ? '—' : Math.round(r.titleCoverage * 100) + '%'} · closing line ${r.closingOk ? 'ok' : 'MISSING'}`);
console.log(`  persona ${r.persona.length} · advice ${r.advice.length} · fear ${r.fear.length} · filler ${r.filler.length} · shared sentences ${r.crossRepeats.length} · connective reuse ${r.connectiveReuse.length} · from previous ${r.connectiveFromPrevious.length}`);
for (const s of r.crossRepeats) console.log(`    shared: "${s.slice(0, 100)}"`);
for (const f of r.fails) console.log(`  ✗ ${f}`);
console.log(r.ok ? 'VERDICT: PASS' : `VERDICT: ${r.fails.length} defect(s)`);
process.exit(r.ok ? 0 : 2);
