// AI Video Studio — backend entry. Express + WebSocket + static SPA.
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { hub } from './ws/hub.js';
import { bindHub, logger } from './util/log.js';
import { ensureDirs, DIRS } from './config/paths.js';
import { mountRoutes } from './api/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
// One source for the version: package.json. It used to be spelled out here, in package.json AND
// in the build script's Info.plist, so a release could ship three different answers.
const VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;

ensureDirs();
bindHub(hub);
await import('./pipeline/journal.js'); // P32 journal: bindJournal before any logger fanout
await import('./core/metering.js'); // cost meter: subscribe to provider usage before any run

// The licence is resolved before anything can run work: the scheduler picks up QUEUED jobs on its
// own, so a copy that boots locked must not quietly carry on rendering what it was left with.
const license = await import('./license/index.js');
license.setAppVersion(VERSION);
license.startLicenseLoop();

try {
  const { recoverZombieProjects } = await import('./db/index.js');
  const n = recoverZombieProjects();
  if (n) logger.info(`boot recovery: ${n} zombie 'running' project(s) → paused`);
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
app.use(express.json({ limit: '64mb' }));
app.use(express.urlencoded({ extended: true, limit: '64mb' }));

// CORS for localhost dev / native shell
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

mountRoutes(app, { version: VERSION });

// SPA static (after API so /api wins). Font filenames encode family+weight+subset,
// so /fonts can be cached immutable — a manifest change produces new URLs.
app.use('/fonts', express.static(join(PUBLIC_DIR, 'fonts'), { maxAge: '365d', immutable: true, fallthrough: false }));
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
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
server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;
  // Write port file so the native shell can discover the URL.
  try { writeFileSync(join(DIRS.data, 'server.url'), url); } catch { /* ignore */ }
  logger.info(`AI Video Studio v${VERSION} ready`);
  // Sentinel line the Swift/launcher waits for:
  console.log(`AVS_READY ${url}`);
});

// Any local TTS server we spawned dies with us — an orphan would hold its port and the next
// start would find an unreachable zombie.
const shutdown = async () => {
  try { (await import('./media/tts-server.js')).stopAllTtsServers(); } catch { /* nothing spawned */ }
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// A long-running render server must never die from one stray async error.
process.on('unhandledRejection', (e) => logger.error(`unhandledRejection: ${e?.message || e}`));
process.on('uncaughtException', (e) => logger.error(`uncaughtException: ${e?.message || e}`));
