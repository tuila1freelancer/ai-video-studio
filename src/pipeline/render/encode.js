// Encoder arguments and the progress reader for the final ffmpeg pass.
export const FPS = 30; // fallback only — the real rate is probed off the clips

/**
 * Turn ffmpeg's `-progress` stream into whole percentages.
 *
 * The stream is key=value lines in blocks, roughly twice a second; `out_time_us` is how far into
 * the OUTPUT it has written. Only forward movement is reported, and only when the whole number
 * changes, so a fifteen-minute encode emits at most a hundred lines instead of two thousand.
 * `N/A` appears in the first block or two and simply does not match.
 *
 * @param {number} total output duration in seconds
 * @param {(pct:number)=>void} onPct
 * @param {(chunk:string)=>void} [passthrough] the caller's own log sink, still fed everything
 */
export function ffProgress(total, onPct, passthrough) {
  let last = -1;
  return (chunk) => {
    passthrough?.(chunk);
    if (!(total > 0)) return;
    let us = null, m;
    const re = /out_time_us=(\d+)/g;
    while ((m = re.exec(chunk))) us = +m[1];
    if (us == null) return;
    // capped at 99: the file is not finished until ffmpeg exits, and reporting 100% while the
    // moov atom is still being written reads as a stall at the very end
    const pct = Math.max(0, Math.min(99, Math.round((us / 1e6) / total * 100)));
    if (pct > last) { last = pct; onPct(pct); }
  };
}

/**
 * `quality` reproduces the reference app's master exactly (crf 18, preset medium, High@4.0) and
 * stays the default for anything the owner publishes.
 *
 * `fast` is the same encoder at the same CRF with a cheaper preset — NOT the hardware encoder,
 * which was the obvious guess and measured worse on every axis. On 158s of real 1080p scene
 * material from this app (M-series, 2026-08-06):
 *
 *   libx264 -preset medium -crf 18   38.4s   44.6 MB   baseline
 *   libx264 -preset veryfast -crf 18 21.8s   43.4 MB   SSIM 0.99952 vs baseline
 *   h264_videotoolbox -q:v 75        24.5s   54.7 MB   SSIM 0.99875 vs baseline
 *
 * VideoToolbox is slower than veryfast, 23% larger, and further from the reference — so there is
 * no configuration in which it wins here and it is not offered. Note the ceiling on all of this:
 * the stream-copy tier does the same job in 4.6s. Picking a cheaper encoder is worth 1.8×;
 * needing no encoder at all is worth 8×, which is why concat-plan.js matters more than this
 * function does.
 */
export function videoCodecArgs(encoder, fps = FPS) {
  const preset = encoder === 'fast' ? 'veryfast' : 'medium';
  return ['-c:v', 'libx264', '-preset', preset, '-crf', '18', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', String(fps)];
}
