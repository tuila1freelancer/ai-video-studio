// Local TTS server lifecycle (P40) — reference-app parity for the self-hosted Supertonic voice.
//
// The reference app spawns `supertonic serve` on demand, waits for the port, deep-checks that a
// tiny synthesis really works (an HTTP-alive-but-broken zombie is worse than a dead port), and
// kills the process on shutdown. Same behaviour here, kept in ONE place so the provider stays a
// pure request/response module and nothing else in the app has to know about child processes.
import { spawn, spawnSync } from 'node:child_process';
import { logger } from '../util/log.js';

const DEFAULT_URL = 'http://127.0.0.1:7788';
const procs = new Map();

/** Normalized base URL for the Supertonic server (no trailing slash). */
export function supertonicUrl(cfg = {}) {
  return String(cfg.serverUrl || cfg.supertonicServerUrl || DEFAULT_URL).replace(/\/+$/, '');
}

function portOf(url) {
  const m = /:(\d+)/.exec(url);
  return m ? Number.parseInt(m[1], 10) : 7788;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cheap liveness: anything that answers on the port counts (405 on GET is a healthy POST-only route). */
export async function isAlive(base, timeoutMs = 3000) {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok || res.status === 405) return true;
  } catch { /* fall through to the root probe */ }
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status > 0;
  } catch { return false; }
}

/** Deep check: a server that answers HTTP but cannot synthesize is a zombie — restart it. */
export async function canSynthesize(base) {
  try {
    const res = await fetch(`${base}/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ok', voice: 'M1', lang: 'vi', steps: 2, speed: 1, response_format: 'wav' }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok && (await res.arrayBuffer()).byteLength > 100;
  } catch { return false; }
}

/** Is the CLI installed? Returns the argv prefix to launch it, or null. */
export function supertonicLauncher() {
  const probe = (cmd, args) => {
    try { return spawnSync(cmd, args, { stdio: 'ignore', timeout: 8000 }).status === 0; } catch { return false; }
  };
  if (probe('supertonic', ['--help'])) return ['supertonic'];
  for (const py of ['python3', 'python']) {
    if (probe(py, ['-c', 'import supertonic'])) return [py, '-m', 'supertonic.cli'];
  }
  return null;
}

export function stopSupertonic(cfg = {}) {
  const p = procs.get('supertonic');
  if (p) {
    try { p.kill('SIGTERM'); } catch { /* already gone */ }
    procs.delete('supertonic');
    logger.info(`[TTS] đã dừng Supertonic (port ${portOf(supertonicUrl(cfg))})`);
    return true;
  }
  return false;
}

/**
 * Make sure a Supertonic server is answering. Returns true when one is usable.
 * Never throws: a machine without the CLI simply reports false and the TTS façade falls back.
 */
export async function ensureSupertonic(cfg = {}, { restart = false, waitMs = 60000 } = {}) {
  const base = supertonicUrl(cfg);
  if (restart) stopSupertonic(cfg);
  else if (await isAlive(base)) {
    if (await canSynthesize(base)) return true;
    logger.warn(`[TTS] Supertonic tại ${base} trả HTTP nhưng synth lỗi — khởi động lại`);
    stopSupertonic(cfg);
  }
  const launcher = supertonicLauncher();
  if (!launcher) {
    logger.info('[TTS] Supertonic chưa cài (pip install supertonic) — bỏ qua');
    return false;
  }
  const url = new URL(base);
  const [cmd, ...pre] = launcher;
  const child = spawn(cmd, [...pre, 'serve', '--host', url.hostname || '127.0.0.1', '--port', String(portOf(base))], {
    detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout?.on('data', (b) => { const s = String(b).trim(); if (s) logger.info(`[TTS][supertonic] ${s}`); });
  child.stderr?.on('data', (b) => { const s = String(b).trim(); if (s) logger.info(`[TTS][supertonic] ${s}`); });
  child.on('exit', (code) => { if (procs.get('supertonic') === child) { procs.delete('supertonic'); logger.info(`[TTS] Supertonic thoát code ${code}`); } });
  child.on('error', (e) => { procs.delete('supertonic'); logger.warn(`[TTS] Supertonic lỗi process: ${e.message}`); });
  procs.set('supertonic', child);

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isAlive(base, 2000)) { logger.info(`[TTS] Supertonic sẵn sàng tại ${base}`); return true; }
    await sleep(1000);
  }
  logger.warn(`[TTS] Supertonic không sẵn sàng trong ${Math.round(waitMs / 1000)}s`);
  return false;
}

export async function ttsServerStatus(cfg = {}) {
  const base = supertonicUrl(cfg);
  return {
    supertonic: {
      url: base,
      running: await isAlive(base),
      managed: procs.has('supertonic'),
      installed: !!supertonicLauncher(),
    },
  };
}

/** Kill everything we spawned — called on server shutdown so no orphan lingers. */
export function stopAllTtsServers() {
  for (const key of [...procs.keys()]) {
    try { procs.get(key)?.kill('SIGTERM'); } catch { /* already gone */ }
    procs.delete(key);
  }
}
