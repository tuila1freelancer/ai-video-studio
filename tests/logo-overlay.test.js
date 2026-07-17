// P26 — final-video logo overlay: logoRect is the single source of truth for BOTH the
// Brand Kit preview and ffmpeg; the render test proves pixel-exact WYSIWYG placement on a
// real encoded frame; the per-scene brand layer drops its logo when the overlay is on.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { logoRect, resolveFinalOverlay } from '../src/media/logo-overlay.js';
import { ffmpeg } from '../src/media/ffmpeg.js';
import { PATHS } from '../src/config/paths.js';
import { resolveBrandKit } from '../src/animation/branding.js';
import { renderFingerprint } from '../src/pipeline/fingerprint.js';
import { concatScenes } from '../src/pipeline/render.js';

test('P26 logoRect: exact integers for known inputs (both orientations, rounding)', () => {
  // 640×360 frame, square 100×100 logo at 20% width → 128×128 at (416, 26)
  assert.deepEqual(
    logoRect({ cxPct: 0.75, cyPct: 0.25, wPct: 0.2 }, { W: 640, H: 360, logoW: 100, logoH: 100 }),
    { lw: 128, lh: 128, x: 416, y: 26 });
  // portrait frame, wide 300×100 logo — height follows the intrinsic aspect
  assert.deepEqual(
    logoRect({ cxPct: 0.5, cyPct: 0.1, wPct: 0.3 }, { W: 1080, H: 1920, logoW: 300, logoH: 100 }),
    { lw: 324, lh: 108, x: 378, y: 138 });
  // odd rounding: lw=Math.round(0.085*1080)=92, lh=round(92*(77/123))=58
  const r = logoRect({ cxPct: 0.92, cyPct: 0.08, wPct: 0.085 }, { W: 1080, H: 1920, logoW: 123, logoH: 77 });
  assert.deepEqual(r, { lw: 92, lh: 58, x: Math.round(0.92 * 1080 - 46), y: Math.round(0.08 * 1920 - 29) });
});

test('P26 resolveFinalOverlay: disabled → null; enabled → clamped fractions', () => {
  assert.equal(resolveFinalOverlay(null), null);
  assert.equal(resolveFinalOverlay({ enabled: false, wPct: 0.2 }), null);
  assert.deepEqual(resolveFinalOverlay({ enabled: true }), { cxPct: 0.92, cyPct: 0.08, wPct: 0.085, opacity: 0.9 });
  const c = resolveFinalOverlay({ enabled: true, cxPct: 2, cyPct: -1, wPct: 0.9, opacity: 0.05 });
  assert.deepEqual(c, { cxPct: 1, cyPct: 0, wPct: 0.45, opacity: 0.2 });
});

test('P26 suppression: finalOverlay.enabled drops the per-scene logo, badge stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p26-'));
  const logoPath = join(dir, 'logo.png');
  writeFileSync(logoPath, Buffer.from('89504e470d0a1a0a', 'hex')); // existence is all resolveBrandKit checks
  const base = { brandKit: { channelName: 'Kênh Thử', placement: 'final', logo: { assetPath: logoPath }, finalOverlay: { enabled: true } } };
  const on = resolveBrandKit(base);
  assert.equal(on.logo, null, 'per-scene logo suppressed');
  assert.ok(on.nameBadge, 'badge survives');
  const off = resolveBrandKit({ brandKit: { ...base.brandKit, placement: 'smart', finalOverlay: { enabled: false } } });
  assert.ok(off.logo, 'logo returns when the overlay is off');
});

test('P26 fingerprint: changing finalOverlay invalidates the render fingerprint', () => {
  const scene = { idx: 0, template: 'hyperframe', props: {}, voice_text: 'x', duration: 5 };
  const cfgA = { visualMode: 'hyperframe', brandKit: { finalOverlay: { enabled: true, cxPct: 0.9, cyPct: 0.1, wPct: 0.1, opacity: 1 } } };
  const cfgB = { visualMode: 'hyperframe', brandKit: { finalOverlay: { enabled: true, cxPct: 0.5, cyPct: 0.1, wPct: 0.1, opacity: 1 } } };
  assert.notEqual(
    renderFingerprint(scene, { config: cfgA, project: {} }),
    renderFingerprint(scene, { config: cfgB, project: {} }));
});

// ---- the WYSIWYG proof: burn a red logo into a real clip and read the pixels back ----
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

test('P26 WYSIWYG render: the logo lands exactly on the logoRect pixels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p26r-'));
  const clip = join(dir, 'clip.mp4'), logo = join(dir, 'logo.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x003300:s=640x360:d=2:r=30',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=100x100:d=1', '-frames:v', '1', logo]);
  const fo = { cxPct: 0.75, cyPct: 0.25, wPct: 0.2, opacity: 1 };
  const rect = logoRect(fo, { W: 640, H: 360, logoW: 100, logoH: 100 }); // {lw:128,lh:128,x:416,y:26}
  const out = await concatScenes([clip], { title: 'wysiwyg', outputDir: dir },
    { dir, size: { w: 640, h: 360 }, logo: { path: logo, ...fo }, transitions: false });
  const px = await grabFrame(out.path, 1.0, 640, 360);
  const inRect = px(rect.x + Math.floor(rect.lw / 2), rect.y + Math.floor(rect.lh / 2));
  assert.ok(inRect.r > 180 && inRect.g < 80 && inRect.b < 80, `logo center is red, got ${JSON.stringify(inRect)}`);
  for (const [x, y, side] of [
    [rect.x - 6, rect.y + 64, 'left of rect'],
    [rect.x + rect.lw + 6, rect.y + 64, 'right of rect'],
    [rect.x + 64, rect.y - 6, 'above rect'],
    [rect.x + 64, rect.y + rect.lh + 6, 'below rect'],
  ]) {
    const p = px(x, y);
    assert.ok(p.r < 60 && p.g > 20, `${side} stays background, got ${JSON.stringify(p)}`);
  }
});

test('P26 back-compat: the legacy {size, position} logo shape still renders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p26l-'));
  const clip = join(dir, 'clip.mp4'), logo = join(dir, 'logo.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x101020:s=320x180:d=1:r=30',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=60x60:d=1', '-frames:v', '1', logo]);
  const out = await concatScenes([clip], { title: 'legacy', outputDir: dir },
    { dir, size: { w: 320, h: 180 }, logo: { path: logo, size: 60, position: 'tl' }, transitions: false });
  assert.ok(existsSync(out.path) && statSync(out.path).size > 1500, 'legacy overlay encodes'); // 1s flat clip is tiny
});
