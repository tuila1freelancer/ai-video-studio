#!/usr/bin/env node
// Renders shell/icon.svg → shell/AppIcon.icns (offline: headless Chrome + sips + iconutil).
// Usage: npm run icon:build
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBrowser, closeBrowser } from '../src/media/puppeteer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = join(ROOT, 'shell', 'icon.svg');
const OUT_DIR = join(ROOT, 'shell', 'build');
const ICONSET = join(OUT_DIR, 'AppIcon.iconset');
const PNG_1024 = join(OUT_DIR, 'icon_1024.png');
const ICNS = join(ROOT, 'shell', 'AppIcon.icns');

async function renderPng() {
  const svg = readFileSync(SVG, 'utf8');
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style></head><body>${svg}</body></html>`;
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const buf = await page.screenshot({ type: 'png', omitBackground: true });
  await page.close();
  writeFileSync(PNG_1024, buf);
  console.log(`✓ rendered ${PNG_1024}`);
}

function buildIcns() {
  rmSync(ICONSET, { recursive: true, force: true });
  mkdirSync(ICONSET, { recursive: true });
  const sizes = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, px] of sizes) {
    execFileSync('sips', ['-z', String(px), String(px), PNG_1024, '--out', join(ICONSET, name)], { stdio: 'pipe' });
  }
  execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS]);
  console.log(`✓ wrote ${ICNS}`);
}

try {
  if (!existsSync(SVG)) throw new Error('shell/icon.svg not found');
  mkdirSync(OUT_DIR, { recursive: true });
  await renderPng();
  buildIcns();
} finally {
  await closeBrowser().catch(() => {});
}
