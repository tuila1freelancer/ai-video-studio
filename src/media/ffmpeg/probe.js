// ffprobe readers: duration, frame rate, image size.
import { spawn } from 'node:child_process';
import { PATHS } from '../../config/paths.js';

export async function probeDuration(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(parseFloat(out.trim()) || 0));
    ps.on('error', () => resolvePromise(0));
  });
}

/** Frame rate of a clip's first video stream, or 0 when it cannot be read. */
export async function probeFrameRate(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => {
      const [n, d] = out.trim().split('/').map(Number);
      const fps = d ? n / d : n;
      resolvePromise(Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 0);
    });
    ps.on('error', () => resolvePromise(0));
  });
}

/** Intrinsic pixel size of an image (first video stream) — {w,h} or null. */
export async function probeImageSize(file) {
  return new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => {
      const [w, h] = out.trim().split(',').map((n) => parseInt(n, 10));
      resolvePromise(w > 0 && h > 0 ? { w, h } : null);
    });
    ps.on('error', () => resolvePromise(null));
  });
}
