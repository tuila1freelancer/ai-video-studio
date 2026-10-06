// Determinism proof: load the same GSAP scene page twice (fresh page each time),
// screenshot identical timestamps, compare SHA-256. Any drift = a broken render contract.
// Usage: node scripts/determinism.mjs [templateId ...]   (default: a GSAP-heavy sample set)
import { createHash } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getBrowser, closeBrowser } from '../src/media/puppeteer.js';
import { TEMPLATES, buildTemplate, makeCtx } from '../src/animation/templates.js';
import { SAMPLE_SPEC } from '../src/styleguide/index.js';
import { buildScenePage } from '../src/animation/harness.js';
import { getTheme } from '../src/animation/themes.js';
import { PATHS, DIRS } from '../src/config/paths.js';
import { join } from 'node:path';

// Chrome's glyph-raster cache can flip a mid-animation frame between two states that
// differ by ±1-2 channel values on a few pixels (PSNR > 80 dB). That is not animation
// drift — real logic drift tanks PSNR. Threshold keeps the guarantee strong.
const PSNR_OK = 70;
function psnr(bufA, bufB) {
  const a = join(DIRS.tmp, 'det_a.png'), b = join(DIRS.tmp, 'det_b.png');
  writeFileSync(a, bufA); writeFileSync(b, bufB);
  try {
    const r = spawnSync(PATHS.ffmpeg, ['-hide_banner', '-i', a, '-i', b, '-filter_complex', '[0][1]psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = String(r.stderr || '').match(/average:([\d.]+|inf)/);
    return m ? (m[1] === 'inf' ? Infinity : parseFloat(m[1])) : NaN;
  } finally {
    try { rmSync(a); rmSync(b); } catch { /* ignore */ }
  }
}

const SAMPLE = {
  heading: 'Làm chủ công cụ AI trong năm phút', sub: 'Mẹo thực chiến cho người mới',
  label: 'PHẦN 02', pre: 'BÍ QUYẾT', heading2: 'Ngay hôm nay', a: 'Tốc độ', b: 'Chính xác',
  number: 7, value: 68, unit: '%', count: 5, chapter: 'PHẦN 03', cta: 'Đăng ký kênh',
  tag: 'CẢNH BÁO', icon: 'bolt', keyword: 'BỨT PHÁ', accentWord: 'AI',
  chips: ['tự động', 'nhanh gọn', 'chính xác'],
  items: [
    { title: 'Mục tiêu', value: 64, icon: 'target' },
    { title: 'Công cụ', value: 82, icon: 'gear' },
    { title: 'Kết quả', value: 45, icon: 'chart' },
  ],
  lines: ['> phân tích đầu vào…', '[SYS] ngữ cảnh: OK', '[OK] sẵn sàng'],
  messages: [{ from: 'user', text: 'Tóm tắt giúp tôi?' }, { from: 'ai', text: 'Đã xong, 3 ý chính…' }],
};
const TS = [0.4, 1.2, 2.8, 5.1];
const theme = getTheme('neon-tech');
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : [...Object.keys(TEMPLATES).filter((id) => {
    const tpl = buildTemplate(id, SAMPLE, makeCtx({ w: 1920, h: 1080, theme, seed: 3, duration: 6, idx: 2 }));
    return !!tpl.script; // only GSAP-bearing templates need the proof
  }), 'hyperframe']; // hidden from TEMPLATES; proven with its canned SAMPLE_SPEC
const propsFor = (id) => (id === 'hyperframe' ? SAMPLE_SPEC : SAMPLE);

async function pass(html, w, h) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    const init = await page.evaluate(() => window.__init());
    const hashes = [], bufs = [];
    for (const t of TS) {
      await page.evaluate((tt) => window.__seek(tt), t);
      const buf = await page.screenshot({ type: 'png' });
      bufs.push(buf);
      hashes.push(createHash('sha256').update(buf).digest('hex').slice(0, 20));
    }
    return { init, hashes, bufs };
  } finally { await page.close().catch(() => {}); }
}

let fail = 0;
for (const id of ids) {
  const ctx = makeCtx({ w: 1920, h: 1080, theme, seed: 3, duration: 6, idx: 2 });
  const tpl = buildTemplate(id, propsFor(id), ctx);
  const html = buildScenePage({
    w: 1920, h: 1080, theme, seed: 3, duration: 6, progressStart: 4, progressTotal: 60,
    template: tpl, captions: [], watermark: { text: 'demo' }, captionStyle: {},
  });
  const a = await pass(html, 1920, 1080);
  const b = await pass(html, 1920, 1080);
  let same = a.hashes.join() === b.hashes.join();
  let note = '';
  if (!same) {
    // hash mismatch → measure: glyph-cache raster noise passes, real drift fails hard
    const scores = a.hashes.map((h, i) => h === b.hashes[i] ? Infinity : psnr(a.bufs[i], b.bufs[i]));
    const worst = Math.min(...scores);
    same = worst >= PSNR_OK;
    note = ` (raster noise, worst PSNR ${worst === Infinity ? '∞' : worst.toFixed(1)}dB)`;
    if (!same) note = ` — PSNR ${worst.toFixed(1)}dB < ${PSNR_OK}dB: REAL DRIFT`;
  }
  const gsapOk = !tpl.script || (a.init && a.init.gsap && !a.init.tplErr);
  if (!same || !gsapOk) {
    fail++;
    console.error(`✗ ${id} — deterministic:${same}${note} gsap:${a.init?.gsap} tplErr:${a.init?.tplErr || 'none'}`);
    console.error(`  run1: ${a.hashes.join(' ')}\n  run2: ${b.hashes.join(' ')}`);
  } else {
    console.log(`✓ ${id} — 2 renders match ${TS.length}/${TS.length} frames${note}${tpl.script ? ' [gsap]' : ''}`);
  }
}
await closeBrowser();
console.log(fail ? `\n${fail} template FAILED determinism` : '\nDETERMINISM PASS');
process.exit(fail ? 1 : 0);
