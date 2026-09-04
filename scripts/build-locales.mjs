// Translate the interface catalogue into every language the app offers.
//
// The owner chose machine translation plus automated checks over paid review, so the checks ARE
// the quality gate and they are strict. Every one of them exists because the failure it catches
// is silent: a dropped {n} renders "Đã xoá {n} file" as "Deleted file"; a lost markdown marker
// turns a bold word in the manual into literal asterisks; a German label 60% longer than its
// Vietnamese source does not wrap, it overflows the button it sits in.
//
//   node scripts/build-locales.mjs            # every language, only missing keys
//   node scripts/build-locales.mjs --lang de  # one language
//   node scripts/build-locales.mjs --all      # re-translate everything, not just what is missing
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from '../src/providers/llm.js';
import { aiSettings } from '../src/db/index.js';
import { LANGUAGES, DEFAULT_LANG } from '../src/i18n/languages.js';
import { checkCatalogue, NO_TRANSLATE } from './lib/locale-check.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'public', 'locales');
const SOURCE = DEFAULT_LANG;
const BATCH = 40;
// Two, not five: the proxy answers a sixth concurrent request with 429, and a rate-limited batch
// is a batch of keys that silently never gets translated.
const CONCURRENCY = 2;
const RETRIES = 3;

// Translating UI labels is not a reasoning task, and the strong model the app uses for scripts is
// the one the proxy rate-limits hardest. --model overrides it; the default keeps whatever the app
// is configured with so this works on an install with one key and one model.
const MODEL = (() => { const i = process.argv.indexOf('--model'); return i > 0 ? process.argv[i + 1] : null; })();

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ALL = process.argv.includes('--all');
const FIX = process.argv.includes('--fix');

// Terms that must read the same in every string of a language, or the interface teaches two names
// for one thing. Sent with every batch rather than hoped for.
const GLOSSARY = [
  'scene = the unit a video is cut into (keep whatever word you choose consistent)',
  'render = producing the video file',
  'thumbnail = the cover image',
  'channel = the YouTube-style channel a video belongs to',
  'voice = the TTS narration',
  'subtitle / caption = the burned-in on-screen text',
];

function sys(row) {
  return `You are localising the interface of a desktop video-production app into ${row.name}.

RULES — every one of these is checked mechanically and a violation is rejected:
1. Reply with ONLY a JSON object mapping each key to its translation. No prose, no fence.
2. Keep every placeholder EXACTLY as written: {n}, {title}, {count}, {0}, {1}. Never translate one,
   never drop one, never invent one. NUMBERED placeholders ({0}, {1}) MAY be reordered when your
   language needs a different word order — they carry their identity in the number. NAMED ones
   should stay where they are.
3. Keep markdown markers exactly: **bold**, *italic*, \`code\`. Keep leading emoji and trailing punctuation.
4. Keep it SHORT. These are buttons, labels and toasts in a fixed layout — aim for the source's
   length, never more than 1.4x it. Say it the way the interface of a native app would, not the
   way a sentence would.
5. Translate meaning, not words. A UI label is an instruction, not prose.
6. Glossary — use one consistent term for each: ${GLOSSARY.join('; ')}.
7. ${row.voiceNote || ''}`;
}

async function translateBatch(entries, row, llm) {
  const payload = Object.fromEntries(entries);
  const reply = await chat([
    { role: 'system', content: sys(row) },
    { role: 'user', content: `Translate the VALUES of this JSON from Vietnamese into ${row.name}. Return the same keys.\n\n${JSON.stringify(payload, null, 1)}` },
  ], { json: true, temperature: 0.2, maxTokens: 8000, llm });
  const text = String(reply || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return out;
}

async function run() {
  const only = arg('--lang');
  const targets = LANGUAGES.filter((l) => l.code !== SOURCE && (!only || l.code === only));
  const llm = MODEL ? { ...aiSettings().llm, model: MODEL, modelFallback: '' } : aiSettings().llm;
  let failures = 0;

  // Two catalogues, one machine: the interface strings, and the in-app manual flattened by
  // scripts/i18n-extract-guide.mjs. They translate identically; only the filename differs.
  const which = process.argv.includes('--guide') ? ['guide.'] : process.argv.includes('--ui') ? [''] : ['', 'guide.'];
  for (const prefix of which) {
    const sourceFile = join(DIR, `${prefix}${SOURCE}.json`);
    if (!existsSync(sourceFile)) { console.log(`no ${prefix}${SOURCE}.json — skipped`); continue; }
    const source = JSON.parse(readFileSync(sourceFile, 'utf8'));
    failures += await translateCatalogue(source, targets, llm, prefix);
  }
  if (failures) console.log(`\n${failures} problems remain — tests/i18n-catalogues.test.js will fail until they are fixed.`);
}

async function translateCatalogue(source, targets, llm, prefix) {
  let failures = 0;
  for (const row of targets) {
    const file = join(DIR, `${prefix}${row.code}.json`);
    const have = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    // --fix closes the loop: whatever the checker rejected is translated AGAIN, rather than left
    // in the file for a human to notice. A dropped **bold** or an echoed source is a defect the
    // machine made and the machine can retry.
    const flagged = FIX
      ? new Set(checkCatalogue(source, have, row.code).map((p) => p.slice(row.code.length + 1, p.indexOf(':', row.code.length + 1))))
      : new Set();
    for (const [k, v] of Object.entries(source)) if (NO_TRANSLATE.test(k)) have[k] = v;
    const todo = Object.entries(source).filter(([k]) => !NO_TRANSLATE.test(k) && (ALL || !(k in have) || flagged.has(k)));
    if (!todo.length) { console.log(`${prefix}${row.code}: up to date (${Object.keys(have).length} keys)`); continue; }
    if (flagged.size) console.log(`${prefix}${row.code}: re-translating ${flagged.size} rejected by the checker`);

    const next = { ...have };
    const slices = [];
    for (let i = 0; i < todo.length; i += BATCH) slices.push(todo.slice(i, i + BATCH));
    // Batches are independent, so they run POOLED. Sequentially this is ~40s per batch and a
    // fourteen-batch language takes ten minutes; twelve languages would be a working afternoon.
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      for (let i = cursor++; i < slices.length; i = cursor++) {
        for (let a = 0; a < RETRIES; a++) {
          try {
            Object.assign(next, await translateBatch(slices[i], row, llm));
            break;
          } catch (e) {
            const last = a === RETRIES - 1;
            if (last) console.log(`\n${row.code}: batch ${i} gave up — ${e.message.slice(0, 80)}`);
            // A throttled batch is keys that silently never get translated, so it waits and
            // tries again rather than being written off.
            else await new Promise((r) => setTimeout(r, 6000 * (a + 1)));
          }
        }
        process.stdout.write(`\r${row.code}: ${++done}/${slices.length} batches   `);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker));
    // Keys the source no longer has are stale translations of deleted UI.
    for (const k of Object.keys(next)) if (!(k in source)) delete next[k];

    const problems = checkCatalogue(source, next, row.code);
    const clean = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
    writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`);
    const missing = Object.keys(source).filter((k) => !(k in clean)).length;
    console.log(`\r${prefix}${row.code}: ${Object.keys(clean).length}/${Object.keys(source).length} keys · ${problems.length} problems${missing ? ` · ${missing} MISSING` : ''}`);
    for (const p of problems.slice(0, 6)) console.log(`    ${p}`);
    failures += problems.length + missing;
  }
  return failures;
}

run();
