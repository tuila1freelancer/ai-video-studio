// Bring an owner-supplied image into a format the renderer can actually use.
//
// The old logo upload accepted png/jpg/webp/svg and rejected everything else with a 400. On a Mac
// that is a trap: screenshots and photos out of Photos are HEIC, and the file picker offers
// image/* — so the owner picks a perfectly good image and the app says no. Converting is both
// friendlier and strictly more capable than refusing.
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, statSync } from 'node:fs';
import { PATHS } from '../../config/paths.js';

/** Formats the renderer and the browser preview both handle as-is — stored untouched. */
export const WEB_SAFE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);

/** Formats we can convert. Anything else is a genuine "not an image we understand". */
export const CONVERTIBLE = new Set(['.heic', '.heif', '.bmp', '.tif', '.tiff', '.avif', '.ico']);

function run(bin, args) {
  return new Promise((resolvePromise, reject) => {
    const ps = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(err.slice(-200) || `${bin} exit ${code}`))));
  });
}

/**
 * Convert `src` to a PNG at `dest`, preserving alpha.
 *
 * Two engines because neither covers everything: ffmpeg reads bmp/tiff/avif/ico but the vendored
 * build has no HEIC decoder; macOS `sips` reads HEIC/HEIF natively. sips is tried first for the
 * Apple formats and ffmpeg is the fallback, so a machine without sips still gets everything else.
 * The source file is removed on success — it is a multer temp upload, not the owner's original.
 */
export async function toPng(src, dest, ext) {
  if (!CONVERTIBLE.has(ext)) throw new Error(`không đọc được ảnh định dạng ${ext.replace('.', '') || 'không rõ'}`);
  const apple = ext === '.heic' || ext === '.heif';
  const attempts = apple
    ? [['/usr/bin/sips', ['-s', 'format', 'png', src, '--out', dest]], [PATHS.ffmpeg, ['-y', '-v', 'error', '-i', src, dest]]]
    : [[PATHS.ffmpeg, ['-y', '-v', 'error', '-i', src, dest]], ['/usr/bin/sips', ['-s', 'format', 'png', src, '--out', dest]]];
  let last = null;
  for (const [bin, args] of attempts) {
    if (!existsSync(bin)) continue;
    try {
      await run(bin, args);
      if (existsSync(dest) && statSync(dest).size > 0) {
        try { unlinkSync(src); } catch { /* temp file, best effort */ }
        return dest;
      }
    } catch (e) { last = e; }
  }
  throw new Error(`không chuyển được ${ext.replace('.', '').toUpperCase()} sang PNG${last ? `: ${last.message.slice(0, 120)}` : ''}`);
}
