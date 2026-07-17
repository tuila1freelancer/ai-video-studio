// Project-asset → self-contained data URI for scene HTML (image-full lane). Scenes must
// stay offline + deterministic (lint bans external URLs), so media is inlined; images are
// downscaled once via ffmpeg (cached by content identity) to keep specs/pages small.
// Video/GIF assets contribute their FIRST FRAME as the hero poster (full inline video would
// be enormous and non-deterministic to decode) — Ken Burns motion supplies the life.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { PATHS, DIRS } from '../config/paths.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

function rawUri(path) {
  try {
    const mime = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  } catch { return null; }
}

/**
 * Inline an asset as a hero-sized data URI. Images (and video/gif first frames) are
 * downscaled to ≤maxW wide JPEG via ffmpeg, cached under DIRS.tmp by (path,size,mtime).
 * Returns null when the file is missing/unreadable.
 */
export function heroMediaUri(path, { maxW = 1280 } = {}) {
  try {
    if (!path || !existsSync(path)) return null;
    if (extname(path).toLowerCase() === '.svg') return rawUri(path); // vector: inline as-is
    const st = statSync(path);
    if (!PATHS.ffmpeg) return rawUri(path);
    const key = createHash('sha1').update(`${path}|${st.size}|${st.mtimeMs}|${maxW}`).digest('hex').slice(0, 16);
    const dir = join(DIRS.tmp, 'asset-uri');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${key}.jpg`);
    if (!existsSync(out)) {
      execFileSync(PATHS.ffmpeg, ['-v', 'error', '-i', path, '-frames:v', '1',
        '-vf', `scale='min(${maxW},iw)':-2`, '-q:v', '4', out, '-y']);
    }
    return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`;
  } catch { return rawUri(path); }
}
