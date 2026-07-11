// Global resource governor — counting semaphores shared by EVERY concurrent run.
// Per-project concurrency (renderConcurrency etc.) bounds one pipeline; these pools bound
// the whole process, so two projects + a manual render can never oversubscribe the machine
// (each frame render holds a Chrome page AND an ffmpeg encode).
import os from 'node:os';

const pools = new Map(); // name -> { cap, used, waiters: [], base? }

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

/**
 * Adaptive capacity for weak/loaded machines: the BASE cap (sized from cores at boot)
 * shrinks when free memory runs low or the load average outruns the cores — each render
 * permit holds a Chrome page AND an ffmpeg encode, the two biggest RAM/CPU consumers.
 * Never grows past base, never below 1; in-flight permits are unaffected (only new
 * grants see the tighter cap).
 */
export function adaptiveCap(base, { freeBytes = os.freemem(), load1 = os.loadavg()[0], cores = os.cpus().length } = {}) {
  let cap = base;
  const freeGB = freeBytes / 1073741824;
  if (freeGB < 1.5) cap = 1;
  else if (freeGB < 3) cap = Math.min(cap, 2);
  if (load1 > cores * 1.5) cap = cap - 1;
  return Math.max(1, Math.min(base, cap));
}

/** Register a pool whose cap is re-derived from machine pressure on every acquire. */
export function configureAdaptivePool(name, base) {
  const p = pool(name);
  p.base = Math.max(1, base | 0);
  p.cap = p.base;
  drain(p);
}

function refresh(p) {
  if (p.base && process.env.AVS_ADAPTIVE !== '0') {
    const cap = adaptiveCap(p.base);
    if (cap !== p.cap) { p.cap = cap; drain(p); }
  }
}

function drain(p) {
  while (p.used < p.cap && p.waiters.length) { p.used++; p.waiters.shift()(); }
}

/** Acquire one permit; resolves with a release() function. Always release in finally. */
export function acquire(name) {
  const p = pool(name);
  refresh(p);
  const grant = () => {
    let released = false;
    return () => { if (released) return; released = true; p.used--; drain(p); };
  };
  if (p.used < p.cap) { p.used++; return Promise.resolve(grant()); }
  return new Promise((resolve) => p.waiters.push(() => resolve(grant())));
}

export function poolStats() {
  const out = {};
  for (const [name, p] of pools) out[name] = { cap: p.cap, used: p.used, waiting: p.waiters.length, ...(p.base ? { base: p.base } : {}) };
  return out;
}

// Default capacities. 'render' covers the heavyweight frame pipeline (Chrome page + ffmpeg
// encode per scene) — the dominant CPU cost. Leave headroom for the server + concat.
// AVS_RENDER_CONCURRENCY pins the base (weak-machine mode / benchmarks); the adaptive layer
// then only ever SHRINKS it under live memory/load pressure (AVS_ADAPTIVE=0 disables).
const RENDER_BASE = Math.max(1, parseInt(process.env.AVS_RENDER_CONCURRENCY, 10) || Math.max(2, Math.min(4, os.cpus().length - 4)));
configureAdaptivePool('render', RENDER_BASE);
