// Shared pipeline helpers with no stage-specific logic: bounded concurrency + output-dir
// resolution.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { acquire } from './governor.js';

/**
 * Run `fn` over `items` with at most `concurrency` in flight; results keep input order.
 * opts.pool: also draw a permit from the named global governor pool per item, so several
 * concurrent runs (two pipelines + a manual render) share one process-wide bound.
 * @template T,R @param {T[]} items @param {number} concurrency @param {(item:T,idx:number)=>Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, concurrency, fn, { pool = null } = {}) {
  const ret = new Array(items.length);
  let i = 0;
  // Fail fast: once one item has thrown the pool starts nothing new. Promise.all already rejects
  // for the caller, but the other workers used to keep pulling — renders and paid TTS calls that
  // finished after the job was settled and wrote over its result.
  let failed = false;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length && !failed) {
      const idx = i++;
      const release = pool ? await acquire(pool) : null;
      try { ret[idx] = await fn(items[idx], idx); } catch (e) { failed = true; throw e; } finally { release?.(); }
    }
  });
  await Promise.all(workers);
  return ret;
}

/**
 * Final videos land in the channel's output/ folder (easy to find in Finder),
 * unless the user picked an explicit outputFolder.
 */
export function resolveOutputDir(projectId, config, dir) {
  if (config.outputFolder && existsSync(config.outputFolder)) return config.outputFolder;
  try {
    const out = join(DB.channelOf(projectId).root_dir, 'output');
    mkdirSync(out, { recursive: true });
    return out;
  } catch { return join(dir, 'output'); }
}

