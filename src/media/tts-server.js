// Local TTS server lifecycle (P40) — the self-hosted Supertonic and VieNeu-TTS voices.
//
// Spawns `supertonic serve` on demand, waits for the port, deep-checks that a tiny synthesis
// really works (an HTTP-alive-but-broken zombie is worse than a dead port), and kills the process
// on shutdown. Kept in ONE place so the provider stays a
// pure request/response module and nothing else in the app has to know about child processes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../util/log.js';

import { tp } from '../i18n/t.js';
import { sleep } from '../util/util.js';
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

let launcherCache; // undefined = never probed
/**
 * Is the CLI installed? Returns the argv prefix to launch it, or null. Probed once per process —
 * three blocking spawns (a Python import can take seconds) used to run on every status poll;
 * `fresh` re-probes after an install.
 */
export function supertonicLauncher({ fresh = false } = {}) {
  if (launcherCache !== undefined && !fresh) return launcherCache;
  const probe = (cmd, args) => {
    try { return spawnSync(cmd, args, { stdio: 'ignore', timeout: 8000 }).status === 0; } catch { return false; }
  };
  launcherCache = null;
  if (probe('supertonic', ['--help'])) launcherCache = ['supertonic'];
  else {
    for (const py of ['python3', 'python']) {
      if (probe(py, ['-c', 'import supertonic'])) { launcherCache = [py, '-m', 'supertonic.cli']; break; }
    }
  }
  return launcherCache;
}

export function stopSupertonic(cfg = {}) {
  const p = procs.get('supertonic');
  if (p) {
    try { p.kill('SIGTERM'); } catch { /* already gone */ }
    procs.delete('supertonic');
    logger.info(`[TTS] stopped Supertonic (port ${portOf(supertonicUrl(cfg))})`);
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
    logger.warn(tp`[TTS] Supertonic tại ${base} trả HTTP nhưng synth lỗi — khởi động lại`);
    stopSupertonic(cfg);
  }
  const launcher = supertonicLauncher();
  if (!launcher) {
    logger.info('[TTS] Supertonic is not installed (pip install supertonic) — skipping');
    return false;
  }
  const url = new URL(base);
  const [cmd, ...pre] = launcher;
  const child = spawn(cmd, [...pre, 'serve', '--host', url.hostname || '127.0.0.1', '--port', String(portOf(base))], {
    detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout?.on('data', (b) => { const s = String(b).trim(); if (s) logger.info(`[TTS][supertonic] ${s}`); });
  child.stderr?.on('data', (b) => { const s = String(b).trim(); if (s) logger.info(`[TTS][supertonic] ${s}`); });
  child.on('exit', (code) => { if (procs.get('supertonic') === child) { procs.delete('supertonic'); logger.info(`[TTS] Supertonic exited with code ${code}`); } });
  child.on('error', (e) => { procs.delete('supertonic'); logger.warn(tp`[TTS] Supertonic lỗi process: ${e.message}`); });
  procs.set('supertonic', child);

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isAlive(base, 2000)) { logger.info(`[TTS] Supertonic ready at ${base}`); return true; }
    await sleep(1000);
  }
  logger.warn(tp`[TTS] Supertonic không sẵn sàng trong ${Math.round(waitMs / 1000)}s`);
  return false;
}

const VIENEU_URL = 'http://127.0.0.1:8000';

/** Normalized base URL for the VieNeu-TTS server (no trailing slash). */
export function vieneuUrl(cfg = {}) {
  return String(cfg.serverUrl || VIENEU_URL).replace(/\/+$/, '');
}

/** The interpreter `uv sync` created inside the VieNeu checkout, or null when it is not there. */
export function vieneuPython(repoDir) {
  if (!repoDir) return null;
  const py = process.platform === 'win32'
    ? join(repoDir, '.venv', 'Scripts', 'python.exe')
    : join(repoDir, '.venv', 'bin', 'python');
  return existsSync(py) ? py : null;
}

/**
 * Make sure a VieNeu server answers. Never throws — false lets the façade fall back.
 * The model loads in ~20–30 s on a laptop CPU, hence the long wait.
 */
export async function ensureVieneu(cfg = {}, { waitMs = 120000 } = {}) {
  const base = vieneuUrl(cfg);
  if (await isAlive(base)) return true;
  const py = vieneuPython(cfg.repoDir);
  if (!py) {
    logger.info('[TTS] VieNeu is not installed (run `uv sync` in the VieNeu-TTS folder) — skipping');
    return false;
  }
  const url = new URL(base);
  const child = spawn(py, ['-m', 'apps.openai_speech'], {
    cwd: cfg.repoDir,
    env: { ...process.env, HOST: url.hostname || '127.0.0.1', PORT: String(portOf(base)) },
    detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const relay = (b) => { const s = String(b).trim(); if (s) logger.info(`[TTS][vieneu] ${s.slice(0, 300)}`); };
  child.stdout?.on('data', relay);
  child.stderr?.on('data', relay);
  child.on('exit', (code) => { if (procs.get('vieneu') === child) { procs.delete('vieneu'); logger.info(`[TTS] VieNeu exited with code ${code}`); } });
  child.on('error', (e) => { procs.delete('vieneu'); logger.warn(tp`[TTS] VieNeu lỗi process: ${e.message}`); });
  procs.set('vieneu', child);

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isAlive(base, 2000)) { logger.info(`[TTS] VieNeu ready at ${base}`); return true; }
    await sleep(1500);
  }
  logger.warn(tp`[TTS] VieNeu không sẵn sàng trong ${Math.round(waitMs / 1000)}s`);
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
