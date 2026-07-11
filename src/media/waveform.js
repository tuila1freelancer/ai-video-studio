// Audio peaks for the timeline's waveform lane. run() collects stderr as text and cannot
// carry binary PCM, so the decode goes to a temp s16le file which is then downsampled to
// max-abs buckets (0..1). Mono 8kHz is plenty for a visual waveform.
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from '../config/paths.js';
import { ffmpeg } from './ffmpeg.js';
import { newId } from '../util/util.js';

export async function audioPeaks(audioPath, { buckets = 240 } = {}) {
  if (!audioPath || !existsSync(audioPath)) throw new Error('audio not found');
  const tmp = join(DIRS.tmp, `${newId('pk')}.raw`);
  try {
    await ffmpeg(['-i', audioPath, '-ac', '1', '-ar', '8000', '-f', 's16le', tmp]);
    const buf = readFileSync(tmp);
    const samples = Math.floor(buf.length / 2);
    if (!samples) return { peaks: [], duration: 0 };
    const n = Math.max(8, Math.min(2000, buckets | 0));
    const per = Math.max(1, Math.floor(samples / n));
    const peaks = [];
    for (let b = 0; b < n; b++) {
      let max = 0;
      const start = b * per, end = Math.min(samples, start + per);
      for (let i = start; i < end; i++) {
        const v = Math.abs(buf.readInt16LE(i * 2));
        if (v > max) max = v;
      }
      peaks.push(+(max / 32768).toFixed(3));
    }
    return { peaks, duration: samples / 8000 };
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}
