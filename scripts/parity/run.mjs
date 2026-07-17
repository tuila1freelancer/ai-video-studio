// Visual-parity harness: render the SAME narration/brief/duration with OUR codegen and put
// the frames next to the reference app's real rendered frames, then score our output against
// the 8-item reference-caliber checklist.
//
//   node scripts/parity/run.mjs --out DIR [--model ag/...] [--only sid/n,...] [--limit N]
//        [--audit-ref]   also DOM-audit the reference HTML pages (threshold calibration)
//        [--no-llm]      skip our codegen/render (ref frames + ref audit only)
//        [--aspect 9:16] our side renders vertical (checklist-only; ref stays 16:9)
//
// AI config comes from the repo DB's `ai` setting (read-only copy) — never hardcoded.
// All output goes under --out; reference data is READ-ONLY.
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
};

const OUT = flag('out') || join(process.env.TMPDIR || '/tmp', 'parity-out');
const MODEL = flag('model');
const ONLY = flag('only') ? String(flag('only')).split(',') : null;
const LIMIT = flag('limit') ? parseInt(flag('limit'), 10) : 0;
const AUDIT_REF = args.includes('--audit-ref');
const NO_LLM = args.includes('--no-llm');
const ASPECT = flag('aspect', '16:9');

// sandbox data dir BEFORE any src import (db opens at first use)
process.env.AVS_DATA_DIR = process.env.AVS_DATA_DIR || join(OUT, 'data');
mkdirSync(process.env.AVS_DATA_DIR, { recursive: true });

const { refPaths, parseSrt, cuesToSrtJson, ffprobeDur, extractFrames, tileImages, sampleTimes, loadManifest } = await import('./lib.mjs');
const { auditScene } = await import('./audit.mjs');
const { generateSceneSpec } = await import(pathToFileURL(join(ROOT, 'src/hyperframe/codegen.js')));
const { extractBeats } = await import(pathToFileURL(join(ROOT, 'src/hyperframe/beats.js')));
const { buildSceneHtml } = await import(pathToFileURL(join(ROOT, 'src/animation/index.js')));
const { presetById } = await import(pathToFileURL(join(ROOT, 'src/styleguide/index.js')));
const { getBrowser, closeBrowser } = await import(pathToFileURL(join(ROOT, 'src/media/puppeteer.js')));

// ---- AI settings: read-only copy from the repo studio DB (constraint: never hardcode)
function aiFromRepoDb() {
  const src = join(ROOT, 'data/studio.sqlite');
  if (!existsSync(src)) return null;
  const Database = require('better-sqlite3');
  const db = new Database(src, { readonly: true });
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='ai'").get();
    return row ? JSON.parse(row.value) : null;
  } finally { db.close(); }
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const manifest = loadManifest(join(ROOT, 'tests/fixtures/parity-manifest.json'));
let samples = manifest.samples;
if (ONLY) samples = samples.filter((s) => ONLY.includes(`${s.sid}/${s.n}`));
if (LIMIT) samples = samples.slice(0, LIMIT);

const ai = aiFromRepoDb();
if (!NO_LLM) {
  if (!ai?.llm?.enabled) { console.error('repo data/studio.sqlite has no enabled ai.llm setting'); process.exit(2); }
  if (MODEL) ai.llm = { ...ai.llm, model: MODEL };
  if (flag('fallback')) ai.llm = { ...ai.llm, modelFallback: flag('fallback') };
  console.log(`codegen model: ${ai.llm.model} @ ${ai.llm.baseUrl}`);
}

const SIZE = ASPECT === '9:16' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
mkdirSync(OUT, { recursive: true });

const gsapVendor = readFileSync(join(ROOT, 'vendor/gsap/gsap.min.js'), 'utf8');
const fontsCss = existsSync(join(ROOT, 'vendor/fonts/fonts.css')) ? readFileSync(join(ROOT, 'vendor/fonts/fonts.css'), 'utf8') : '';

const OFFLINE_REF = args.includes('--offline-ref');
async function refPage(browser, htmlPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  if (OFFLINE_REF) {
    // no network: swap the CDN gsap for our vendor copy and drop webfont links
    let html = readFileSync(htmlPath, 'utf8')
      .replace(/<script src="https:\/\/cdn[^"]*gsap[^"]*"><\/script>/i, `<script>${gsapVendor}</script>`)
      .replace(/<link[^>]*fonts\.googleapis[^>]*>/gi, `<style>${fontsCss}</style>`)
      .replace(/<link[^>]*fonts\.gstatic[^>]*>/gi, '');
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
  } else {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 30000 });
  }
  await page.evaluate(async () => {
    try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const ok = await page.evaluate(() => {
    const tls = window.__timelines || {};
    const tl = tls.main || Object.values(tls)[0];
    if (!tl) return false;
    window.__ptl = tl; tl.pause();
    return true;
  });
  return { page, ok };
}

const results = [];
const browser = await getBrowser();

// --rescore: re-run ONLY the checklist on previously saved ours.html pages (no LLM, no
// frames) — the cheap loop for calibrating audit thresholds against a fixed render set.
if (args.includes('--rescore')) {
  for (const s of samples) {
    const label = `${s.sid.replace('sess_', '')}_${s.n}`;
    const dir = join(OUT, label);
    const htmlPath = join(dir, 'ours.html');
    if (!existsSync(htmlPath)) continue;
    const p = refPaths(s.sid, s.n);
    const duration = Math.max(1.5, +ffprobeDur(p.video).toFixed(3));
    const cues = parseSrt(readFileSync(p.srt, 'utf8'));
    const beats = extractBeats(cuesToSrtJson(cues), [], duration);
    const page = await browser.newPage();
    await page.setViewport({ width: SIZE.w, height: SIZE.h, deviceScaleFactor: 1 });
    await page.setContent(readFileSync(htmlPath, 'utf8'), { waitUntil: 'load', timeout: 30000 });
    const init = await page.evaluate(() => window.__init());
    const entry = { ...s, label, duration };
    if (!init?.tplErr) {
      const seek = (t) => page.evaluate((tt) => window.__seek(tt), t);
      entry.audit = await auditScene({ page, seek, duration, beats, hasBeats: true });
      console.log(`${label}: ${entry.audit.passed}/${entry.audit.scored} ${JSON.stringify(Object.fromEntries(Object.entries(entry.audit.checks).map(([k, v]) => [k, v.pass === null ? '-' : v.pass ? 'P' : 'F'])))}`);
      for (const [k, v] of Object.entries(entry.audit.checks)) if (v.pass === false) console.log(`   ✗ ${k}: ${v.detail}`);
    } else { entry.error = init.tplErr; console.log(`${label}: __init error ${init.tplErr}`); }
    await page.close().catch(() => {});
    results.push(entry);
  }
  summarize(results);
  await closeBrowser();
  process.exit(0);
}

for (const s of samples) {
  const p = refPaths(s.sid, s.n);
  const label = `${s.sid.replace('sess_', '')}_${s.n}`;
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  const duration = Math.max(1.5, +ffprobeDur(p.video).toFixed(3));
  const cues = parseSrt(readFileSync(p.srt, 'utf8'));
  const srtJson = cuesToSrtJson(cues);
  const times = sampleTimes(duration);
  const entry = { ...s, label, duration };
  console.log(`\n== ${label} [${s.cat}/${s.energy}] dur=${duration}s`);

  // 1) reference frames (ground truth pixels from the app's own render)
  entry.refFrames = extractFrames(p.video, times, dir, 'ref');

  // 2) optional: DOM-audit the reference page (calibration)
  if (AUDIT_REF) {
    try {
      const withTO = (pr, ms, lbl) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${lbl}`)), ms))]);
      const { page, ok } = await withTO(refPage(browser, p.html), 45000, 'refPage');
      if (ok) {
        const seek = (t) => page.evaluate((tt) => { try { window.__ptl.seek(tt, false); } catch { window.__ptl.progress(Math.min(1, tt / window.__ptl.duration())); } }, t);
        entry.refAudit = await withTO(auditScene({ page, seek, duration, beats: [], hasBeats: false }), 90000, 'refAudit');
        console.log(`  ref audit: ${entry.refAudit.passed}/${entry.refAudit.scored} ${JSON.stringify(Object.fromEntries(Object.entries(entry.refAudit.checks).map(([k, v]) => [k, v.pass])))}`);
      } else console.log('  ref audit: no __timelines found');
      await page.close().catch(() => {});
    } catch (err) { console.log(`  ref audit failed: ${String(err.message).slice(0, 120)}`); }
  }

  // 3) our side: codegen (real LLM) → page → frames → audit
  if (!NO_LLM) {
    const scene = {
      idx: Math.max(0, s.n - 1), voice_text: s.voice, visual_prompt: s.visual,
      duration, srt_json: srtJson, keywords: [],
    };
    const guide = presetById('tuila1-hud-cyber');
    const t0 = Date.now();
    try {
      const gen = await generateSceneSpec({
        scene, guide, w: SIZE.w, h: SIZE.h, idx: scene.idx, total: Math.max(s.n + 1, 100),
        ai, density: 'rich', captionsOn: false,
        onLog: (m) => console.log(`  [codegen] ${m}`),
      });
      entry.tier = gen.tier;
      entry.genMs = Date.now() - t0;
      writeFileSync(join(dir, 'ours-spec.json'), JSON.stringify(gen.props, null, 2));
      const project = { aspect_ratio: ASPECT, title: 'parity' };
      const config = { visualMode: 'hyperframe', enableSubtitles: false };
      const sceneRow = { ...scene, template: 'hyperframe', props: gen.props };
      const html = buildSceneHtml(sceneRow, project, config, { total: 100, durationOverride: duration });
      writeFileSync(join(dir, 'ours.html'), html);
      const page = await browser.newPage();
      await page.setViewport({ width: SIZE.w, height: SIZE.h, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      const init = await page.evaluate(() => window.__init());
      if (init?.tplErr) throw new Error(`__init: ${init.tplErr}`);
      const seek = (t) => page.evaluate((tt) => window.__seek(tt), t);
      entry.oursFrames = [];
      for (let i = 0; i < times.length; i++) {
        await seek(times[i]);
        const f = join(dir, `ours_${i}.jpg`);
        await page.screenshot({ path: f, type: 'jpeg', quality: 90 });
        entry.oursFrames.push(f);
      }
      entry.audit = await auditScene({ page, seek, duration, beats: gen.beats, hasBeats: true });
      await page.close().catch(() => {});
      console.log(`  ours: tier=${entry.tier} ${entry.audit.passed}/${entry.audit.scored} ${JSON.stringify(Object.fromEntries(Object.entries(entry.audit.checks).map(([k, v]) => [k, `${v.pass === null ? '-' : v.pass ? 'P' : 'F'}`])))}`);
      for (const [k, v] of Object.entries(entry.audit.checks)) if (v.pass === false) console.log(`    ✗ ${k}: ${v.detail}`);
    } catch (err) {
      entry.error = String(err.message).slice(0, 300);
      console.log(`  OUR SIDE FAILED: ${entry.error}`);
    }
  }

  // 4) contact sheet for this sample (top: ours, bottom: ref)
  if (entry.oursFrames?.length === 4) {
    entry.sheet = tileImages([...entry.oursFrames, ...entry.refFrames], 4, 480, join(dir, 'sheet.jpg'));
  }
  results.push(entry);
}

summarize(results);
// mega contact sheet (one row per sample: 4 ours + 4 ref)
const sheetRows = results.filter((r) => r.sheet).map((r) => r.sheet);
if (sheetRows.length) tileImages(sheetRows, 1, 1920, join(OUT, 'contact-sheet-all.jpg'));
await closeBrowser();
process.exit(0);

function summarize(res) {
  const scored = res.filter((r) => r.audit);
  const fullPass = scored.filter((r) => r.audit.full);
  const perCheck = {};
  for (const r of scored) for (const [k, v] of Object.entries(r.audit.checks)) {
    if (v.pass === null) continue;
    perCheck[k] = perCheck[k] || { pass: 0, total: 0 };
    perCheck[k].total++; if (v.pass) perCheck[k].pass++;
  }
  const summary = {
    when: new Date().toISOString(), model: NO_LLM ? null : ai?.llm?.model, aspect: ASPECT,
    samples: res.length, scoredSamples: scored.length,
    fullPass: fullPass.length,
    fullPassRate: scored.length ? +(fullPass.length / scored.length).toFixed(3) : 0,
    perCheck, tiers: Object.fromEntries(scored.map((r) => [r.label, r.tier])),
    failures: Object.fromEntries(scored.filter((r) => !r.audit.full).map((r) => [r.label,
      Object.entries(r.audit.checks).filter(([, v]) => v.pass === false).map(([k, v]) => `${k}: ${v.detail}`)])),
    errors: Object.fromEntries(res.filter((r) => r.error).map((r) => [r.label, r.error])),
    refAudit: AUDIT_REF ? Object.fromEntries(res.filter((r) => r.refAudit).map((r) => [r.label, { passed: r.refAudit.passed, scored: r.refAudit.scored, checks: Object.fromEntries(Object.entries(r.refAudit.checks).map(([k, v]) => [k, v.pass])) }])) : undefined,
  };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(res.map(({ ...r }) => r), null, 2));
  console.log(`\n==== PARITY SUMMARY ====`);
  console.log(`full-checklist pass: ${fullPass.length}/${scored.length} (${Math.round((summary.fullPassRate) * 100)}%)`);
  console.log(`per-check: ${Object.entries(perCheck).map(([k, v]) => `${k}=${v.pass}/${v.total}`).join(' ')}`);
  console.log(`output: ${OUT}`);
}
