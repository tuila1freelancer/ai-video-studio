// Headless Chrome (Chrome for Testing) via puppeteer-core — rasterizes scene HTML into a
// poster image. Spun up lazily, reused, warmed up to avoid first-paint races.
import { join } from 'node:path';
import { PATHS, DIRS } from '../config/paths.js';
import { newId } from '../util/util.js';

let browserPromise = null;
export function chromeAvailable() { return !!PATHS.chrome; }

export async function getBrowser() {
  if (!PATHS.chrome) throw new Error('Chrome not available');
  // Self-heal: a crashed/disconnected Chrome would otherwise poison the cache forever.
  if (browserPromise) {
    try {
      const b = await browserPromise;
      const alive = typeof b.isConnected === 'function' ? b.isConnected() : b.connected !== false;
      if (!alive) throw new Error('browser disconnected');
    } catch { browserPromise = null; }
  }
  if (!browserPromise) {
    browserPromise = (async () => {
      // ~2 MB of JS the server never needs until the first render — parsed then, not at boot.
      const { default: puppeteer } = await import('puppeteer-core');
      const browser = await puppeteer.launch({
        executablePath: PATHS.chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--hide-scrollbars',
          '--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none',
          // P40: software WebGL so a three.js scene layer actually renders headless. Verified
          // byte-identical output on non-WebGL pages (SwiftShader only serves WebGL contexts —
          // 2D text/SVG rasterization is untouched), so existing renders are unaffected.
          // Without these a WebGLRenderer throws "Error creating WebGL context" and takes the
          // whole scene script down with it.
          '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      });
      // warm-up: first page load is slow; do it once so real screenshots paint fully.
      try { const p = await browser.newPage(); await p.setContent('<body style="background:#000"></body>'); await p.close(); } catch { /* ignore */ }
      return browser;
    })();
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    try { (await browserPromise).close(); } catch { /* ignore */ }
    browserPromise = null;
  }
}

// Serialize screenshots — concurrent heavy paints on one browser race the capture.
let queue = Promise.resolve();
// Page-side code travels as a STRING, never as a function.
//
// Puppeteer serialises a function by calling `fn.toString()` and parsing the result. A release runs
// from V8 bytecode against a blank placeholder source, so toString() returns spaces — the exact
// length of the original and nothing else — and every page.evaluate(fn) dies on "Passed function
// cannot be serialized!". Only a real render through a real release finds this.
const SETTLED = `(async () => {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
})()`;

export function screenshotHtml(html, opts = {}) {
  const job = queue.then(() => doScreenshot(html, opts));
  queue = job.catch(() => {});
  return job;
}

/**
 * @param {string} html
 * @param {{w:number,h:number,outPath?:string,scale?:number,quality?:number}} opts
 *   `scale` multiplies the DEVICE resolution, never the layout: the page is still laid out at w×h,
 *   so every authored px keeps its intended relative size, and text/SVG re-rasterise at the higher
 *   resolution. Setting the viewport to 2w×2h instead would halve the relative size of everything
 *   the designer wrote — the same distinction the 4K video lane draws between its logical canvas
 *   and its physical frame.
 *   The output FORMAT follows the file extension. It used to be PNG unconditionally while every
 *   caller named its file `.jpg`, which was merely untidy at 1× and becomes a real problem at 2×:
 *   a 2560×1440 PNG is 5–8 MB and YouTube refuses a thumbnail over 2 MB.
 */
async function doScreenshot(html, { w, h, outPath, scale = 1, quality = 92 } = {}) {
  const out = outPath || join(DIRS.tmp, `${newId('poster')}.png`);
  const jpeg = /\.jpe?g$/i.test(out);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: Math.max(1, Math.min(4, +scale || 1)) });
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    // Ensure fonts loaded + two animation frames painted before capture.
    await page.evaluate(SETTLED);
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({
      path: out,
      captureBeyondViewport: false,
      ...(jpeg ? { type: 'jpeg', quality: Math.max(60, Math.min(100, Math.round(quality))) } : { type: 'png' }),
    });
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}
