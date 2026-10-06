// Housekeeping for the two directories nothing else ever empties: data/tmp (frame previews,
// asset URIs, waveforms) and data/uploads (multer's landing zone). Measured on the user's
// machine: 142 entries from three months back in tmp, 69 in uploads.
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './log.js';

const KEEP_MS = 7 * 24 * 3600 * 1000;

/**
 * Remove entries older than a week from `dirs`, one at a time, off the request path.
 * A file in use by a running job is younger than that by construction.
 * @returns {Promise<{removed:number, bytes:number}>}
 */
export async function sweepStale(dirs, { keepMs = KEEP_MS, now = Date.now() } = {}) {
  let removed = 0; let bytes = 0;
  for (const dir of dirs) {
    let names = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const name of names) {
      const p = join(dir, name);
      try {
        const st = await stat(p);
        if (now - st.mtimeMs < keepMs) continue;
        await rm(p, { recursive: true, force: true });
        removed += 1; bytes += st.size;
      } catch { /* vanished or busy — next time */ }
    }
  }
  if (removed) logger.info(`sweep: ${removed} stale temp entries removed (${(bytes / 1048576).toFixed(1)} MB)`);
  return { removed, bytes };
}
