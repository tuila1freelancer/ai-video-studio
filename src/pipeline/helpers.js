// Shared pipeline helpers with no stage-specific logic: bounded concurrency, output-dir
// resolution, per-project visual/subtitle option assembly.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { assStyleFrom } from '../subtitles/presets.js';

/**
 * Run `fn` over `items` with at most `concurrency` in flight; results keep input order.
 * @template T,R @param {T[]} items @param {number} concurrency @param {(item:T,idx:number)=>Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, concurrency, fn) {
  const ret = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) { const idx = i++; ret[idx] = await fn(items[idx], idx); }
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

function styleNameOf(id) {
  const s = DB.listStyles('scene').find((x) => x.id === id);
  return s ? s.name : 'Cinematic';
}

/** Image-mode visual options (background builder dir + style + consistency flag). */
export function visualOpts(config, dir) {
  return {
    dir: join(dir, 'html'),
    mode: config.richAnimation === false ? 'graphic' : undefined,
    styleName: styleNameOf(config.styleId),
    consistent: !!config.consistentScenes,
  };
}

// ASS style resolves through the shared subtitle-preset catalog (same source as the
// animation captions) — identical output to the old inline object when no preset.
export function subtitleStyleFrom(config) { return assStyleFrom(config); }
