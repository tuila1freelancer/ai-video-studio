// P28 — copyright watermark: one perimeter path (perimeterPos) drives both the preview and
// the ffmpeg expressions; the render tests prove the burned watermark actually sits on the
// sampled path and MOVES over time, for both the logo and the drawtext lanes.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { perimeterPos, perimeterExpr, resolveWatermark, watermarkFont, WM_SPEEDS } from '../src/media/watermark.js';
import { ffmpeg, hasDrawtext } from '../src/media/ffmpeg.js';
import { PATHS } from '../src/config/paths.js';
import { concatScenes } from '../src/pipeline/render.js';

test('P28 perimeterPos: corner anchors at quarter phases, continuous in between', () => {
  const box = { bw: 0.1, bh: 0.1, mx: 0.02, my: 0.02 };
  assert.deepEqual(perimeterPos(0, box), { x: 0.02, y: 0.02 });
  assert.deepEqual(perimeterPos(0.25, box), { x: 0.88, y: 0.02 });
  assert.deepEqual(perimeterPos(0.5, box), { x: 0.88, y: 0.88 });
  assert.deepEqual(perimeterPos(0.75, box), { x: 0.02, y: 0.88 });
  // continuity at a segment joint: just before/after 0.25 stay adjacent
  const a = perimeterPos(0.2499, box), b = perimeterPos(0.2501, box);
  assert.ok(Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01);
  // wraps
  const w = perimeterPos(1.1, box), w2 = perimeterPos(0.1, box);
  assert.deepEqual(w, w2);
});

test('P28 resolveWatermark: off → null; on → clamped config with defaults', () => {
  assert.equal(resolveWatermark(null), null);
  assert.equal(resolveWatermark({ enabled: false }), null);
  const wm = resolveWatermark({ enabled: true, speed: 'warp', opacity: 9, wPct: 0.5, hPct: 0 });
  assert.equal(wm.speed, 'slow');
  assert.equal(wm.opacity, 0.8);
  assert.equal(wm.wPct, 0.2);
  assert.equal(wm.hPct, 0.018);
  assert.equal(resolveWatermark({ enabled: true, source: 'name' }).source, 'name');
});

const balanced = (s) => {
  let depth = 0;
  for (const c of s) { if (c === '(') depth++; else if (c === ')') depth--; if (depth < 0) return false; }
  return depth === 0;
};

test('P28 perimeterExpr: t-driven expressions carry the right variable names per filter', () => {
  const ov = perimeterExpr({ period: 45, marginPx: 4 });
  assert.ok(balanced(ov.x), `x parens balanced: ${ov.x}`);
  assert.ok(balanced(ov.y), `y parens balanced: ${ov.y}`);
  assert.match(ov.x, /mod\(t,45\)/);
  assert.match(ov.x, /\(W-w-4\)/);
  const dt = perimeterExpr({ varW: 'w', varH: 'h', varw: 'tw', varh: 'th', period: 120, marginPx: 24 });
  assert.match(dt.x, /\(w-tw-24\)/);
  assert.ok(!dt.x.includes('W-'), 'drawtext lane must not use overlay-style W/H variables');
  assert.match(dt.y, /\(h-th-24\)/);
  assert.match(dt.y, /mod\(t,120\)/);
});

test('P28 watermarkFont: the vendored Vietnamese-safe TTF resolves', () => {
  const f = watermarkFont();
  assert.ok(f && /\.ttf$/i.test(f), `expected a ttf, got ${f}`);
});

// ---- render proofs ----
function grabFrame(video, at, w, h) {
  return new Promise((resolve, reject) => {
    const ps = spawn(PATHS.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', video,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const chunks = [];
    ps.stdout.on('data', (d) => chunks.push(d));
    ps.on('error', reject);
    ps.on('close', () => {
      const buf = Buffer.concat(chunks);
      assert.equal(buf.length, w * h * 3, 'full raw frame');
      resolve((x, y) => ({ r: buf[(y * w + x) * 3], g: buf[(y * w + x) * 3 + 1], b: buf[(y * w + x) * 3 + 2] }));
    });
  });
}
async function makeClip(dir, { w, h, dur, color }) {
  const clip = join(dir, 'clip.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:d=${dur}:r=30`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(dur), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  return clip;
}

test('P28 render (logo lane): the watermark sits ON the sampled path and moves along it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p28l-'));
  const clip = await makeClip(dir, { w: 320, h: 180, dur: 6, color: '0x101020' });
  const logo = join(dir, 'wm.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=100x100:d=1', '-frames:v', '1', logo]);
  const wm = { path: logo, source: 'logo', speed: 'medium', opacity: 1, wPct: 0.1, marginPct: 0.02 };
  const out = await concatScenes([clip], { title: 'wm', outputDir: dir },
    { dir, size: { w: 320, h: 180 }, watermark: wm, transitions: false });
  const P = WM_SPEEDS.medium, m = Math.round(180 * 0.02), box = 32; // wPct .1 * 320
  const centerAt = (t) => {
    const p = perimeterPos((t % P) / P, { bw: box / 320, bh: box / 180, mx: m / 320, my: m / 180 });
    return { x: Math.round(p.x * 320) + box / 2, y: Math.round(p.y * 180) + box / 2 };
  };
  const t1 = 0.6, t2 = 5.0;
  const c1 = centerAt(t1), c2 = centerAt(t2);
  assert.ok(Math.abs(c1.x - c2.x) > 60, `sampled centers far apart (${c1.x} vs ${c2.x})`);
  const px1 = await grabFrame(out.path, t1, 320, 180);
  const px2 = await grabFrame(out.path, t2, 320, 180);
  const p1 = px1(c1.x, c1.y), p1far = px1(c2.x, c2.y);
  const p2 = px2(c2.x, c2.y), p2far = px2(c1.x, c1.y);
  assert.ok(p1.r > 150 && p1.g < 80, `t=${t1}: red at its own center, got ${JSON.stringify(p1)}`);
  assert.ok(p1far.r < 80, `t=${t1}: NOT red where it will be later, got ${JSON.stringify(p1far)}`);
  assert.ok(p2.r > 150 && p2.g < 80, `t=${t2}: red at the moved center, got ${JSON.stringify(p2)}`);
  assert.ok(p2far.r < 80, `t=${t2}: the old spot is background again, got ${JSON.stringify(p2far)}`);
});

test('P28 render (drawtext lane): the channel name burns along the top edge', async (t) => {
  const font = watermarkFont();
  if (!font || !(await hasDrawtext())) return t.skip('no vendored ttf or no drawtext-capable ffmpeg');
  const dir = mkdtempSync(join(tmpdir(), 'p28t-'));
  const clip = await makeClip(dir, { w: 320, h: 180, dur: 2, color: '0x101020' });
  const wm = { text: 'Kênh Thử ©', fontFile: font, source: 'name', speed: 'medium', opacity: 0.8, hPct: 0.09, marginPct: 0.02 };
  const out = await concatScenes([clip], { title: 'wmtxt', outputDir: dir },
    { dir, size: { w: 320, h: 180 }, watermark: wm, transitions: false });
  const px = await grabFrame(out.path, 1.0, 320, 180);
  let bright = 0;
  for (let y = 2; y < 30; y++) for (let x = 0; x < 320; x += 2) {
    const p = px(x, y);
    if (p.r > 150 && p.g > 150 && p.b > 150) bright++;
  }
  assert.ok(bright > 5, `text pixels along the top band (found ${bright})`);
});
