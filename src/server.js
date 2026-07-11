// AI Video Studio — backend entry. Express + WebSocket + static SPA.
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { hub } from './ws/hub.js';
import { bindHub, logger } from './util/log.js';
import { ensureDirs, DIRS } from './config/paths.js';
import { mountRoutes } from './api/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const VERSION = '1.0.0';

ensureDirs();
bindHub(hub);
await import('./core/metering.js'); // cost meter: subscribe to provider usage before any run
try {
  const { recoverZombieProjects } = await import('./db/index.js');
  const n = recoverZombieProjects();
  if (n) logger.info(`boot recovery: ${n} zombie 'running' project(s) → paused`);
  // After P13's project recovery: requeue jobs orphaned by the dead process and start the
  // scheduler — queued/batched work continues across restarts instead of being stranded.
  const { startScheduler } = await import('./pipeline/scheduler.js');
  startScheduler();
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
hub.attach(server);

const PORT = parseInt(process.env.AVS_PORT || '0', 10); // 0 = auto-pick free port
server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;
  // Write port file so the native shell can discover the URL.
  try { writeFileSync(join(DIRS.data, 'server.url'), url); } catch { /* ignore */ }
  logger.info(`AI Video Studio v${VERSION} ready`);
  // Sentinel line the Swift/launcher waits for:
  console.log(`AVS_READY ${url}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

// A long-running render server must never die from one stray async error.
process.on('unhandledRejection', (e) => logger.error(`unhandledRejection: ${e?.message || e}`));
process.on('uncaughtException', (e) => logger.error(`uncaughtException: ${e?.message || e}`));
