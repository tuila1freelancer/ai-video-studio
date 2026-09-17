#!/usr/bin/env node
// Boot audit: what the first paint of the UI costs, measured — not guessed.
//
//   node scripts/perf/boot-audit.mjs [--lang vi|en] [--runs 3] [--json out.json] [--dist]
//
// --dist measures the release payload: the frontend is built into a temp dir first and the
// server is pointed at it, so the numbers are what a customer's WKWebView sees.
//
// Boots a throwaway server on a SNAPSHOT of the live database (VACUUM INTO a temp dir, every
// queued job cancelled so nothing starts rendering), loads the UI in headless Chrome with the
// network log attached, and reports requests, bytes, serial API hops and the boot marks that
// main.js sets. The same script runs before and after a change, so the numbers compare.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';
import { PATHS } from '../../src/config/paths.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const LANG = arg('lang', 'vi');
const RUNS = Math.max(1, parseInt(arg('runs', '3'), 10) || 3);
const JSON_OUT = arg('json', '');
const DIST = process.argv.includes('--dist');

if (!PATHS.chrome) { console.error('boot-audit: no Chrome resolved (PATHS.chrome)'); process.exit(2); }

/** A private data dir holding a consistent copy of the live DB with every job neutralised. */
function snapshotDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'avs-boot-audit-'));
  const liveDb = join(ROOT, 'data', 'studio.sqlite');
  if (!existsSync(liveDb)) throw new Error(`no live database at ${liveDb}`);
  const snap = join(dir, 'studio.sqlite');
  const live = new Database(liveDb, { readonly: true });
  live.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  live.close();
  const db = new Database(snap);
  db.exec(`
    UPDATE jobs SET status='cancelled' WHERE status IN ('queued','running');
    UPDATE projects SET status='paused', stop_requested_at=NULL WHERE status='running';
    UPDATE calendar_slots SET status='cancelled' WHERE status='queued';
    INSERT INTO settings(key,value) VALUES('uiLang','${LANG}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  `);
  db.close();
  for (const f of ['channel.json']) {
    const src = join(ROOT, 'data', f);
    if (existsSync(src)) copyFileSync(src, join(dir, f));
  }
  // The owner's thumbnail cache comes along, warm: a cold cache would charge every run twenty
  // ffmpeg encodes that a real boot only pays once.
  const thumbs = join(ROOT, 'data', 'tmp', 'thumbs');
  if (existsSync(thumbs)) cpSync(thumbs, join(dir, 'tmp', 'thumbs'), { recursive: true });
  return dir;
}

function buildDist() {
  const dir = join(mkdtempSync(join(tmpdir(), 'avs-perf-dist-')), 'public');
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-frontend.mjs'), '--out', dir], { stdio: 'pipe' });
  return dir;
}

function startServer(dataDir, publicDir) {
  return new Promise((resolveUrl, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'src', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, AVS_DATA_DIR: dataDir, AVS_PORT: '0', TOOLS_LICENSE_BYPASS: '1', AVS_DEBUG: '', ...(publicDir ? { AVS_PUBLIC_DIR: publicDir } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (buf) => {
      out += String(buf);
      const m = out.match(/AVS_READY (http:\/\/[^\s]+)/);
      if (m) resolveUrl({ child, url: m[1] });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`server exited early (${code})\n${out.slice(-2000)}`)));
    setTimeout(() => reject(new Error(`server did not print AVS_READY\n${out.slice(-2000)}`)), 30000).unref();
  });
}

function kind(url, mime) {
  const p = new URL(url).pathname;
  if (p.startsWith('/api/')) return 'api';
  if (p.startsWith('/locales/')) return 'locale';
  if (p.startsWith('/fonts/') || /font/.test(mime)) return 'font';
  if (p.endsWith('.js') || /javascript/.test(mime)) return 'js';
  if (p.endsWith('.css') || /css/.test(mime)) return 'css';
  if (p === '/' || p.endsWith('.html') || /html/.test(mime)) return 'html';
  return 'other';
}

async function measure(url) {
  const browser = await puppeteer.launch({
    executablePath: PATHS.chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    const reqs = new Map();
    cdp.on('Network.requestWillBeSent', (e) => { reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp, method: e.request.method }); });
    cdp.on('Network.responseReceived', (e) => {
      const r = reqs.get(e.requestId); if (!r) return;
      r.status = e.response.status; r.mime = e.response.mimeType; r.fromCache = !!e.response.fromDiskCache;
      r.encoding = e.response.headers?.['content-encoding'] || e.response.headers?.['Content-Encoding'] || '';
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = reqs.get(e.requestId); if (!r) return;
      r.t1 = e.timestamp; r.bytes = e.encodedDataLength;
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // main.js marks the moment the shell is painted with real data and the moment idle work is done.
    const marks = await page.waitForFunction(() => {
      const m = (n) => performance.getEntriesByName(n)[0]?.startTime;
      const idle = m('avs:idle-done');
      return idle ? { boot: m('avs:boot-done'), idle } : null;
    }, { timeout: 60000, polling: 100 }).then((h) => h.jsonValue());
    // Let straggling requests (fonts loading after idle) settle.
    await new Promise((r) => setTimeout(r, 1500));
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, ttfb: n.responseStart };
    });
    const wall = Date.now() - t0;
    const rows = [...reqs.values()].filter((r) => r.status !== undefined);
    const byKind = {};
    const apiCalls = {};
    let bytes = 0;
    for (const r of rows) {
      const k = kind(r.url, r.mime || '');
      byKind[k] = byKind[k] || { n: 0, bytes: 0 };
      byKind[k].n += 1; byKind[k].bytes += r.bytes || 0; bytes += r.bytes || 0;
      if (k === 'api') { const p = new URL(r.url).pathname.replace(/\/[0-9a-z]{16,}(?=\/|$)/g, '/:id'); apiCalls[p] = (apiCalls[p] || 0) + 1; }
    }
    // Serial API depth: the longest chain of API responses that each started after the previous finished.
    const api = rows.filter((r) => kind(r.url, r.mime || '') === 'api' && r.t1).sort((a, b) => a.t0 - b.t0);
    let depth = 0; let lastEnd = -Infinity;
    for (const r of api) { if (r.t0 >= lastEnd) { depth += 1; lastEnd = r.t1; } else if (r.t1 > lastEnd) lastEnd = r.t1; }
    const compressed = rows.filter((r) => r.encoding).length;
    const top = [...rows].sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 12)
      .map((r) => ({ url: new URL(r.url).pathname + (new URL(r.url).search ? '?…' : ''), bytes: r.bytes || 0, mime: r.mime || '',
        // a file response is named by its path so the report says WHICH file was heavy
        file: /\/api\/(?:file|thumb)/.test(r.url) ? (new URL(r.url).searchParams.get('path') || '').split('/').slice(-2).join('/') : undefined }));
    // The slowest responses by wall time: what the idle phase is actually waiting on.
    const slowest = [...rows].filter((r) => r.t1).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0)).slice(0, 8)
      .map((r) => ({ url: new URL(r.url).pathname, ms: Math.round((r.t1 - r.t0) * 1000) }));
    return { requests: rows.length, bytes, byKind, apiCalls, serialApiDepth: depth, compressed, top, slowest, marks, nav, wall };
  } finally {
    await browser.close();
  }
}

function fmtKB(b) { return `${(b / 1024).toFixed(0)} KB`; }

async function main() {
  const dataDir = snapshotDataDir();
  const publicDir = DIST ? buildDist() : null;
  const { child, url } = await startServer(dataDir, publicDir);
  const runs = [];
  try {
    for (let i = 0; i < RUNS; i += 1) runs.push(await measure(url));
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
    if (publicDir) rmSync(dirname(publicDir), { recursive: true, force: true });
  }
  const med = (sel) => { const v = runs.map(sel).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const r0 = runs[0];
  const summary = {
    lang: LANG, runs: RUNS, url, tree: DIST ? 'release' : 'dev',
    requests: r0.requests, bytes: r0.bytes, compressed: r0.compressed, byKind: r0.byKind, apiCalls: r0.apiCalls,
    serialApiDepth: r0.serialApiDepth,
    bootDoneMs: med((r) => r.marks.boot), idleDoneMs: med((r) => r.marks.idle),
    dclMs: med((r) => r.nav.dcl), loadMs: med((r) => r.nav.load), wallMs: med((r) => r.wall),
  };
  console.log(`\nBoot audit (lang=${LANG}, ${DIST ? 'release payload' : 'dev tree'}, ${RUNS} run${RUNS > 1 ? 's, medians' : ''})`);
  console.log(`  requests        ${summary.requests}  (${summary.compressed} compressed)`);
  console.log(`  bytes on wire   ${fmtKB(summary.bytes)}`);
  for (const [k, v] of Object.entries(summary.byKind).sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`    ${k.padEnd(8)} ${String(v.n).padStart(3)} req  ${fmtKB(v.bytes).padStart(8)}`);
  }
  console.log(`  serial API hops ${summary.serialApiDepth}`);
  console.log(`  API calls       ${Object.values(summary.apiCalls).reduce((a, b) => a + b, 0)}`);
  for (const [p, n] of Object.entries(summary.apiCalls).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(2)}× ${p}`);
  console.log('  heaviest responses');
  for (const t of r0.top) console.log(`    ${fmtKB(t.bytes).padStart(8)}  ${t.url}${t.file ? `  (${t.file}, ${t.mime})` : ''}`);
  console.log('  slowest responses');
  for (const t of r0.slowest) console.log(`    ${String(t.ms).padStart(6)} ms  ${t.url}`);
  console.log(`  DOMContentLoaded ${summary.dclMs.toFixed(0)} ms · boot-done ${summary.bootDoneMs.toFixed(0)} ms · idle-done ${summary.idleDoneMs.toFixed(0)} ms · load ${summary.loadMs.toFixed(0)} ms`);
  if (JSON_OUT) { writeFileSync(JSON_OUT, `${JSON.stringify({ summary, runs }, null, 2)}\n`); console.log(`  → ${JSON_OUT}`); }
}

main().catch((e) => { console.error(`boot-audit: ${e.stack || e.message}`); process.exit(1); });
