// Global resource governor — counting semaphores shared by EVERY concurrent run.
// Per-project concurrency (renderConcurrency etc.) bounds one pipeline; these pools bound
// the whole process, so two projects + a manual render can never oversubscribe the machine
// (each frame render holds a Chrome page AND an ffmpeg encode).
import os from 'node:os';

const pools = new Map(); // name -> { cap, used, waiters: [] }

function pool(name) {
  if (!pools.has(name)) pools.set(name, { cap: 4, used: 0, waiters: [] });
  return pools.get(name);
}

/** Set a pool's capacity (raising it wakes waiters). */
export function configurePool(name, cap) {
  const p = pool(name);
  p.cap = Math.max(1, cap | 0);
  drain(p);
}

function drain(p) {
  while (p.used < p.cap && p.waiters.length) { p.used++; p.waiters.shift()(); }
}

/** Acquire one permit; resolves with a release() function. Always release in finally. */
export function acquire(name) {
  const p = pool(name);
  const grant = () => {
    let released = false;
    return () => { if (released) return; released = true; p.used--; drain(p); };
  };
  if (p.used < p.cap) { p.used++; return Promise.resolve(grant()); }
  return new Promise((resolve) => p.waiters.push(() => resolve(grant())));
}

export function poolStats() {
  const out = {};
  for (const [name, p] of pools) out[name] = { cap: p.cap, used: p.used, waiting: p.waiters.length };
  return out;
}

// Default capacities. 'render' covers the heavyweight frame pipeline (Chrome page + ffmpeg
// encode per scene) — the dominant CPU cost. Leave headroom for the server + concat.
configurePool('render', Math.max(2, Math.min(4, os.cpus().length - 4)));
