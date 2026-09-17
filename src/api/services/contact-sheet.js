// One JPEG tiling a mid-frame of every scene, keyed by what the scenes currently are.
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { ffmpeg } from '../../media/ffmpeg.js';
import { mapPool } from '../../pipeline/helpers.js';

const FRAME_TIMEOUT_MS = 60_000;

/**
 * @param {object} p project row
 * @param {object[]} scenes scenes with something to show (template, image or clip)
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<string>} path of the sheet
 */
export async function buildContactSheet(p, scenes, { fresh = false } = {}) {
  const dir = join(DB.projectDirFor(p.id), 'contact');
  mkdirSync(dir, { recursive: true });
  const sig = createHash('md5').update(JSON.stringify(scenes.map((s) =>
    [s.id, s.video_path || '', s.status, s.duration, s.template || '']))).digest('hex').slice(0, 10);
  const out = join(dir, `sheet-${sig}.jpg`);
  if (existsSync(out) && !fresh) return out;
  const { previewSceneFrame } = await import('../../animation/index.js');
  // Clip frames are one ffmpeg seek each and run four abreast; page previews serialise on the
  // shared browser anyway. 200 scenes used to mean 200 sequential spawns inside one request.
  await mapPool(scenes, 4, async (sc, i) => {
    const frame = join(dir, `f-${String(i).padStart(3, '0')}.jpg`);
    const mid = Math.max(0.4, (sc.duration || 6) / 2);
    if (sc.video_path && existsSync(sc.video_path)) {
      await ffmpeg(['-ss', String(mid), '-i', sc.video_path, '-frames:v', '1', '-q:v', '4', frame], { signal: AbortSignal.timeout(FRAME_TIMEOUT_MS) });
    } else {
      await previewSceneFrame(sc, p, p.config || {}, { outPath: frame, t: mid });
    }
  });
  const cols = scenes.length <= 4 ? 2 : scenes.length <= 9 ? 3 : 4;
  // tile pads any short final row with the background color, so cols×rows never has to
  // match the scene count exactly
  await ffmpeg(['-framerate', '1', '-i', join(dir, 'f-%03d.jpg'), '-vf',
    `scale=480:-2,tile=${cols}x${Math.ceil(scenes.length / cols)}:padding=6:color=0x0B0B12`,
    '-frames:v', '1', '-q:v', '4', out], { signal: AbortSignal.timeout(FRAME_TIMEOUT_MS) });
  return out;
}
