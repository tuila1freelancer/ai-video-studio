// AI Video Studio — backend entry. Express + WebSocket + static SPA.
import express from 'express';
import compression from 'compression';
import http from 'node:http';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { hub } from './ws/hub.js';
import { bindHub, logger } from './util/log.js';
import { openLogFile } from './util/log-file.js';
import { sweepStale } from './util/sweep.js';
import { assembleIndex } from './util/html-include.js';
import { createHash } from 'node:crypto';
import { ensureDirs, DIRS, ROOT } from './config/paths.js';
import { mountRoutes } from './api/routes.js';
import { errorHandler, processHealth } from './api/http.js';
import { setUiLang } from './i18n/t.js';
import db, { getSetting } from './db/index.js';

// Both of these hang off ROOT rather than this file's own location: a release bundles the whole
// server into one file, so "one directory up from here" stops meaning what it means in the repo.
// AVS_PUBLIC_DIR points the dev server at a built payload, which is how a release is smoke-tested.
const PUBLIC_DIR = process.env.AVS_PUBLIC_DIR || join(ROOT, 'public');
// One source for the version: package.json. It used to be spelled out here, in package.json AND
// in the build script's Info.plist, so a release could ship three different answers.
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// The boot sequence is a function, not top level, because a release ships this file compiled to
// V8 bytecode — and bytecode is a SCRIPT, which cannot contain top-level await. The awaits below
// are load-bearing ordering (journal binds before any logger fanout, metering subscribes before
// any run), so they stay exactly where they are; only their container changed.
async function boot() {
  ensureDirs();
  openLogFile(join(DIRS.data, 'logs'));
  bindHub(hub);
  await import('./pipeline/journal.js'); // P32 journal: bindJournal before any logger fanout
  await import('./core/metering.js'); // cost meter: subscribe to provider usage before any run

  // The licence is resolved before anything can run work: the scheduler picks up QUEUED jobs on its
  // own, so a copy that boots locked must not quietly carry on rendering what it was left with.
  const license = await import('./license/index.js');
  license.setAppVersion(VERSION);
  // A repackaged dist (protection stripped) locks itself before the scheduler can pick up work.
  // No file is deleted — the copy simply refuses to run until a clean re-activation.
  const { distIntegrityProblem } = await import('./license/integrity.js');
  const tamper = distIntegrityProblem();
  if (tamper) {
    license.markTampered(tamper);
    logger.error(`integrity: ${tamper} — bản cài đã bị can thiệp, khoá lại`);
  }
  license.startLicenseLoop();

  try {
    const { recoverZombieProjects, stopRequestedProjects } = await import('./db/index.js');
    const n = recoverZombieProjects();
    if (n) logger.info(`boot recovery: ${n} zombie 'running' project(s) → paused`);
    // Re-arm any stop the owner asked for before the app was closed. requeueZombieJobs (below,
    // inside startScheduler) cancels those jobs outright; this covers the rest — anything that
    // does reach a checkpoint in this process stops at it instead of running to completion.
    const { hydrateStops } = await import('./pipeline/stop.js');
    const pending = stopRequestedProjects();
    if (pending.length) {
      hydrateStops(pending);
      logger.info(`boot recovery: ${pending.length} dự án đã được yêu cầu dừng — giữ nguyên trạng thái dừng`);
    }
    // After P13's project recovery: requeue jobs orphaned by the dead process and start the
    // scheduler — queued/batched work continues across restarts instead of being stranded.
    const { startScheduler } = await import('./pipeline/scheduler.js');
    const { isRunnable } = await import('./license/state.js');
    if (isRunnable(license.status())) {
      startScheduler();
    } else {
      logger.warn('Chưa có license hợp lệ — tạm dừng nhận việc mới. Kích hoạt trong app để tiếp tục.');
      // Activating must not mean restarting: the moment the verdict turns runnable, the queue
      // resumes with whatever was left in it.
      let started = false;
      license.licenseEvents.on('change', (next) => {
        if (started || !isRunnable(next)) return;
        started = true;
        logger.info('License đã hợp lệ — tiếp tục hàng đợi công việc');
        startScheduler();
      });
    }
  } catch (e) { logger.warn(`boot recovery failed: ${e.message}`); }

  const app = express();
  app.disable('x-powered-by');
  // Loopback is fast but not free: a 2 MB project list still parses faster as 300 KB.
  app.use(compression({ threshold: 1024 }));
  // Bodies are forms, except the three routes that carry a scene's HTML or an SRT. Previously
  // every route accepted 64 MB — from any origin, since the API also answered with CORS `*`.
  const jsonSmall = express.json({ limit: '2mb' });
  const jsonLarge = express.json({ limit: '64mb' });
  const LARGE_BODY = /^\/(scenes\/[^/]+(\/custom-html)?|projects\/[^/]+\/thumbnail\/regen)$/;
  app.use('/api', (req, res, next) => (LARGE_BODY.test(req.path) ? jsonLarge : jsonSmall)(req, res, next));
  app.use('/api', express.urlencoded({ extended: true, limit: '2mb' }));
  // No CORS header: both shells and the browser load the UI from this very origin, and a
  // wildcard let any web page the owner visited call DELETE /api/projects.

  mountRoutes(app, { version: VERSION });
  app.use('/api', errorHandler);

  // SPA static (after API so /api wins). Font filenames encode family+weight+subset,
  // so /fonts can be cached immutable — a manifest change produces new URLs.
  app.use('/fonts', express.static(join(PUBLIC_DIR, 'fonts'), { maxAge: '365d', immutable: true, fallthrough: false }));
  // The document is assembled from its partials once, served from memory, always revalidated
  // (the release build hashes everything it references). The partials themselves are not a page.
  const indexHtml = assembleIndex(PUBLIC_DIR);
  const indexEtag = `"${createHash('sha1').update(indexHtml).digest('hex').slice(0, 16)}"`;
  const sendIndex = (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', indexEtag);
    if (req.headers['if-none-match'] === indexEtag) return res.status(304).end();
    res.type('html').send(indexHtml);
  };
  app.get(['/', '/index.html'], sendIndex);
  app.use('/partials', (req, res) => res.status(404).end());
  // A release build names every script and stylesheet by its content hash, so those can live in
  // the cache forever; a dev tree has no hashes and every file is revalidated.
  const HASHED = /-[A-Z0-9]{8}\.(?:js|css)$/;
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, path) => { if (HASHED.test(path)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); },
  }));
  // Deep links get the document; a missing asset gets a 404, not 120 KB of HTML parsed as script.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).end();
    sendIndex(req, res);
  });

  const server = http.createServer(app);

  const PORT = parseInt(process.env.AVS_PORT || '0', 10); // 0 = auto-pick free port
  // A BUSY PORT MUST BE FATAL AND LOUD. Without this, the 'error' event has no listener, so it
  // throws — straight into the catch-all `uncaughtException` handler below, which only logs. The
  // process then stays alive, never listening, never printing AVS_READY. The app launcher polls
  // /api/health, gets a 200 FROM THE OLD SERVER, and happily loads the UI: everything looks fine
  // while you are running yesterday's code. That is a debugging nightmare, and it is why a
  // "rebuild" appears to fix things that a rebuild has nothing to do with.
  server.on('error', (e) => {
    if (e?.code === 'EADDRINUSE') {
      logger.error(`cổng ${PORT} đang bị chiếm — một server AI Video Studio khác vẫn đang chạy. Thoát tiến trình cũ rồi mở lại (App: thoát hẳn app; terminal: kill tiến trình 'node src/server.js').`);
      console.error(`AVS_PORT_IN_USE ${PORT}`);
    } else {
      logger.error(`server listen failed: ${e?.message || e}`);
    }
    process.exit(1);
  });
  // AFTER the handler above, and that order is load-bearing: `ws` attaches its own 'error'
  // listener to the http server which RE-THROWS, so a WebSocketServer created first turns this
  // into an uncaughtException before our listener is ever reached (verified — the whole point of
  // the handler is lost). Listeners fire in registration order, so ours must be registered first.
  hub.attach(server);
  // The owner's interface language, restored before anything can produce a message in it.
  try { setUiLang(getSetting('uiLang')); } catch { /* first boot, no settings row yet */ }
  server.listen(PORT, '127.0.0.1', () => {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}`;
    // Write port file so the native shell can discover the URL.
    try { writeFileSync(join(DIRS.data, 'server.url'), url); } catch { /* ignore */ }
    logger.info(`AI Video Studio v${VERSION} ready`);
    // Sentinel line the Swift/launcher waits for:
    console.log(`AVS_READY ${url}`);
    // Housekeeping after the UI is reachable, never before.
    setTimeout(() => { sweepStale([DIRS.tmp, DIRS.uploads]).catch((e) => logger.warn(`sweep: ${e.message}`)); }, 15000).unref();
  });

  // Everything this process owns goes down with it: spawned TTS servers (an orphan holds its port
  // and the next start finds an unreachable zombie), headless Chrome, in-flight ffmpeg children
  // (aborted like a user stop, so the run resumes cleanly), WebSocket clients (server.close()
  // would otherwise wait on them forever), then the DB with a checkpointed WAL.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(1), 3000).unref(); // never hang on a socket that will not close
    try { (await import('./media/tts-server.js')).stopAllTtsServers(); } catch { /* nothing spawned */ }
    try { await (await import('./media/puppeteer.js')).closeBrowser(); } catch { /* never launched */ }
    try { (await import('./pipeline/stop.js')).abortAll(); } catch { /* nothing running */ }
    hub.close();
    server.close(() => {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { logger.warn(`db close: ${e.message}`); }
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // A long-running render server must never die from one stray async error — but after one,
  // in-memory state (governor pools, stop flags) may disagree with the DB, and /health says so.
  const survived = (kind) => (e) => {
    logger.error(`${kind}: ${e?.stack || e?.message || e}`);
    processHealth.degraded = { kind, message: String(e?.message || e), at: Date.now() };
  };
  process.on('unhandledRejection', survived('unhandledRejection'));
  process.on('uncaughtException', survived('uncaughtException'));
}

// Nothing has registered uncaughtException yet while boot() is running, so a failure here would
// otherwise be an unhandled rejection with a warning and a live, useless process.
boot().catch((e) => {
  logger.error(`boot failed: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
