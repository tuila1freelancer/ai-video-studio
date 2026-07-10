// Headless Chrome (Chrome for Testing) via puppeteer-core — rasterizes scene HTML into a
// poster image. Spun up lazily, reused, warmed up to avoid first-paint races.
import puppeteer from 'puppeteer-core';
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
      const browser = await puppeteer.launch({
        executablePath: PATHS.chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--hide-scrollbars',
          '--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none'],
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
export function screenshotHtml(html, opts = {}) {
  const job = queue.then(() => doScreenshot(html, opts));
  queue = job.catch(() => {});
  return job;
}

async function doScreenshot(html, { w, h, outPath } = {}) {
  const out = outPath || join(DIRS.tmp, `${newId('poster')}.png`);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    // Ensure fonts loaded + two animation frames painted before capture.
    await page.evaluate(async () => {
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* ignore */ }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: out, type: 'png', captureBeyondViewport: false });
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}
