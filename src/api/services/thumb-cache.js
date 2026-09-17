// Downscaled copies of project thumbnails and library art for the gallery.
//
// A project thumbnail is the 1280×720 render itself — 450–580 KB — and the home gallery shows
// twenty of them at 300 px. Measured: ~10 MB of the 11.7 MB a cold boot transferred. One ffmpeg
// scale per (file, size, mtime, width) is cached under data/tmp/thumbs and served from there.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PATHS, DIRS } from '../../config/paths.js';

const WIDTHS = new Set([160, 320, 480, 640]);
const inflight = new Map();
// A cold gallery asks for twenty thumbnails in the same tick; four encoders at a time keep the
// machine (and the render that may be running) responsive, the rest queue.
const MAX_ENCODERS = 4;
let running = 0;
const waiting = [];
function slot() {
  if (running < MAX_ENCODERS) { running += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve)).then(() => { running += 1; });
}
function release() { running -= 1; waiting.shift()?.(); }

/** The nearest offered width, so a stray query cannot fill the cache with one-off sizes. */
export function thumbWidth(w) {
  const n = Number(w) || 320;
  return [...WIDTHS].reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), 320);
}

/**
 * Path of a JPEG at most `w` wide for `src`, rendering it on first use. Resolves null when the
 * source is missing or ffmpeg is unavailable (the caller then serves the original).
 * @param {string} src absolute path inside an allowed root
 * @param {number} w one of WIDTHS
 * @returns {Promise<string|null>}
 */
export function thumbFor(src, w) {
  if (!src || !existsSync(src) || !PATHS.ffmpeg) return Promise.resolve(null);
  const st = statSync(src);
  const key = createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}|${w}`).digest('hex').slice(0, 20);
  const dir = join(DIRS.tmp, 'thumbs');
  const out = join(dir, `${key}.jpg`);
  if (existsSync(out)) return Promise.resolve(out);
  if (inflight.has(out)) return inflight.get(out);
  mkdirSync(dir, { recursive: true });
  const job = slot().then(() => new Promise((resolve) => {
    execFile(PATHS.ffmpeg, ['-v', 'error', '-i', src, '-frames:v', '1', '-vf', `scale='min(${w},iw)':-2`, '-q:v', '5', out, '-y'],
      { timeout: 20000 }, (err) => resolve(err ? null : out));
  }).finally(release)).finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}
