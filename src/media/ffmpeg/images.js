// Still images: the brand-asset transparency gate (P27) and the gradient backdrop.
import { spawn } from 'node:child_process';
import { PATHS } from '../../config/paths.js';

import { ffmpeg } from './run.js';

// Brand-asset transparency gate (P27): a generated character PNG must carry a REAL alpha
// channel and its background must actually be transparent. Pixel-format check first (an
// opaque JPEG/RGB24 fails immediately), then the mean alpha of the four 8×8 corner patches
// — a character never fills all four corners, so ≥3 near-zero corners ⇔ transparent bg.
export async function verifyTransparentBg(file, { patch = 8, maxMeanAlpha = 16, minClearCorners = 3 } = {}) {
  const px = await new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(out.trim()));
    ps.on('error', () => resolvePromise(''));
  });
  // csv follows the stream section's NATURAL field order (width,height,pix_fmt) — not the request order
  const [wS, hS, fmt] = px.split(',');
  const w = parseInt(wS, 10), h = parseInt(hS, 10);
  if (!/(rgba|bgra|abgr|argb|ya8|ya16|gbrap|yuva|pal8)/.test(fmt || '') || !(w > patch && h > patch)) {
    return { ok: false, reason: `no alpha channel (pix_fmt ${fmt || '?'})` };
  }
  const corners = [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]];
  let clear = 0;
  const means = [];
  for (const [x, y] of corners) {
    const { err } = await ffmpegQuiet(['-i', file, '-vf',
      `format=rgba,alphaextract,crop=${patch}:${patch}:${x}:${y},signalstats,metadata=print`,
      '-f', 'null', '-']);
    const m = err.match(/signalstats\.YAVG=([\d.]+)/);
    const mean = m ? parseFloat(m[1]) : 255;
    means.push(Math.round(mean));
    if (mean <= maxMeanAlpha) clear++;
  }
  return clear >= minClearCorners
    ? { ok: true, corners: means }
    : { ok: false, reason: `background not transparent (corner alpha means ${means.join('/')})`, corners: means };
}

// metadata=print writes to stderr at info level — bypass the -loglevel error wrapper.
function ffmpegQuiet(args) {
  return new Promise((resolvePromise, reject) => {
    const ps = spawn(PATHS.ffmpeg, ['-y', '-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', (d) => err += d.toString());
    ps.on('error', reject);
    ps.on('close', (code) => code === 0 ? resolvePromise({ err }) : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`)));
  });
}

// Generate a solid/gradient background image sized for the aspect ratio (used when no image given).
export async function makeGradientImage(outPath, { w, h, c1 = '0x1e293b', c2 = '0x0f172a' }) {
  await ffmpeg([
    '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c1}:c1=${c2}:x0=0:y0=0:x1=${w}:y1=${h}`,
    '-frames:v', '1', outPath,
  ]);
  return outPath;
}
