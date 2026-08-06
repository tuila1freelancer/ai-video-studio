// Deterministic HTML-animation → MP4 renderer.
// For each scene: load the harness page once, then for every frame call __seek(t),
// capture a JPEG and pipe it straight into ffmpeg (image2pipe) — flat RAM, any length.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { getBrowser } from '../media/puppeteer.js';
import { PATHS } from '../config/paths.js';
import { makeSilence, probeDuration } from '../media/ffmpeg.js';
import { logger } from '../util/log.js';

const JPEG_QUALITY = 92;
const FRAME_TIMEOUT_MS = 45000; // generous — under load a single screenshot can stall well past 15s

function withTimeout(promise, ms, label) {
  let to;
  const t = new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`timeout: ${label}`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(to));
}

/**
 * Render one scene page to an mp4.
 * opts: { html, w, h, fps, duration, audioPath (nullable), outPath,
 *         previewPath (nullable — mid-scene JPEG), onProgress(fraction), onLog }
 * Returns { path, duration }.
 */
export async function renderScenePage(opts) {
  const { html, w, h, fps, duration, outPath } = opts;
  const frames = Math.max(1, Math.round(duration * fps));
  let audio = opts.audioPath;
  if (!audio) { audio = outPath.replace(/\.mp4$/, '_sil.m4a'); await makeSilence(audio, duration); }

  let fontMiss = [];
  const attempt = async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    let ff = null;
    try {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      const init = await withTimeout(page.evaluate(() => window.__init()), 20000, '__init');
      if (init && init.tplErr) logger.warn(`Cảnh animation: script template lỗi (chỉ render CSS): ${init.tplErr}`);
      if (init && init.fontMiss && init.fontMiss.length) {
        // Never a silent substitute — the owner picked these families explicitly. This probe has
        // existed since P30 and only ever reached logger.warn, which is to say: nowhere the
        // owner looks. It is the same shape as the wrong-language warning that let 22 scenes
        // ship in the wrong language, so it now travels back to the caller and onto the run log.
        fontMiss = init.fontMiss;
        const msg = `⚠ font không nạp được, trình duyệt sẽ thay bằng font khác: ${fontMiss.join(', ')} — kiểm tra Thư viện → Font chữ`;
        logger.warn(msg);
        opts.onLog?.(msg);
      }
      logger.debug?.(`anim scene init: ${init && init.n != null ? init.n : init} animations${init && init.gsap ? ' + gsap timeline' : ''}`);

      // ffmpeg consumer: JPEG frames on stdin + scene audio → h264 mp4
      ff = spawn(PATHS.ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
        '-i', audio,
        '-map', '0:v', '-map', '1:a',
        '-t', duration.toFixed(3),
        // P39: match the reference app's per-scene encode (crf 18, preset medium, High@4.0) —
        // one visible notch above the old crf20/veryfast on the same q92-JPEG frame source.
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
        '-movflags', '+faststart', outPath,
      ], { stdio: ['pipe', 'ignore', 'pipe'] });
      let ffErr = '';
      ff.stderr.on('data', (d) => { ffErr += d.toString(); });
      const ffDone = new Promise((res, rej) => {
        ff.on('error', rej);
        ff.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-500)}`)));
      });
      // If the frame loop throws first (timeout → kill), nobody awaits ffDone anymore;
      // mark it handled so the orphaned rejection can't crash the whole server.
      ffDone.catch(() => {});

      const writeFrame = (buf) => new Promise((res, rej) => {
        if (!ff.stdin.writable) return rej(new Error('ffmpeg stdin closed early: ' + ffErr.slice(-300)));
        const ok = ff.stdin.write(buf, (e) => e ? rej(e) : undefined);
        if (ok) res(); else ff.stdin.once('drain', res);
      });

      const midFrame = Math.floor(frames / 2);
      for (let i = 0; i < frames; i++) {
        const t = i / fps;
        await withTimeout(page.evaluate((tt) => window.__seek(tt), t), FRAME_TIMEOUT_MS, `seek f${i}`);
        const buf = await withTimeout(
          page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, optimizeForSpeed: true }),
          FRAME_TIMEOUT_MS, `shot f${i}`,
        );
        await writeFrame(buf);
        if (i === midFrame && opts.previewPath) { try { writeFileSync(opts.previewPath, buf); } catch { /* ignore */ } }
        if (opts.onProgress && (i % fps === 0 || i === frames - 1)) opts.onProgress((i + 1) / frames);
      }
      ff.stdin.end();
      await ffDone;
      return { path: outPath, duration: await probeDuration(outPath) || duration, fontMiss };
    } finally {
      try { if (ff && ff.exitCode == null) { ff.stdin.destroy(); ff.kill('SIGKILL'); } } catch { /* ignore */ }
      await page.close().catch(() => {});
    }
  };

  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { return await attempt(); }
    catch (e) {
      lastErr = e;
      logger.warn(`Render animation lần ${i + 1} lỗi (${e.message}) — ${i < 2 ? 'thử lại' : 'bỏ cuộc'}`);
      await new Promise((r) => setTimeout(r, 2000 + i * 3000)); // let the machine breathe
    }
  }
  throw lastErr;
}

// Render a single mid-scene preview frame (for the UI) without producing a video.
export async function renderPreviewFrame(html, { w, h, t, outPath }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    const init = await withTimeout(page.evaluate(() => window.__init()), 20000, 'preview __init');
    if (init && init.tplErr) logger.warn(`preview template script failed: ${init.tplErr}`);
    await page.evaluate((tt) => window.__seek(tt), t);
    const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
    writeFileSync(outPath, buf);
    return outPath;
  } finally {
    await page.close().catch(() => {});
  }
}
