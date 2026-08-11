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

test('P26 per-scene layer: logo is stamp-only — resolveBrandKit exposes badge/stickers, never a logo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p26-'));
  const logoPath = join(dir, 'logo.png');
  writeFileSync(logoPath, Buffer.from('89504e470d0a1a0a', 'hex'));
  const kit = resolveBrandKit({ brandKit: { channelName: 'Kênh Thử', logo: { assetPath: logoPath }, finalOverlay: { enabled: true } } });
  assert.ok(kit.nameBadge, 'badge rides the scene layer');
  assert.equal('logo' in kit, false, 'no per-scene logo lane exists anymore');
  // legacy placement:'off' still silences the per-scene chrome entirely
  assert.equal(resolveBrandKit({ brandKit: { channelName: 'X', placement: 'off' } }), null);
});

// CONTRACT REVERSED, deliberately (2026-08-06). P26 asserted the opposite: that moving the logo
// stamp invalidated every clip's render fingerprint. That was wrong, and expensively so — the
// stamp is drawn by concatScenes onto the ASSEMBLED programme, so no clip contains it and no clip
// changes when it moves. Under the old rule, nudging the badge or switching it off cost 105 scene
// re-renders to change a single ffmpeg overlay filter, which made "turn the logo off" as
// expensive as remaking the video.
//
// The clips are pixel-identical either way; only our idea of which inputs matter has changed. So
// the digest ignores it, and renderCurrent accepts the older digest so the 11 projects measured
// carrying this key do not re-render over the redefinition. See tests/fingerprint.test.js.
test('moving or removing the logo stamp does NOT invalidate any clip', () => {
  const scene = { idx: 0, template: 'hyperframe', props: {}, voice_text: 'x', duration: 5 };
  const cfg = (finalOverlay) => ({ visualMode: 'hyperframe', brandKit: { finalOverlay } });
  const fp = (finalOverlay) => renderFingerprint(scene, { config: cfg(finalOverlay), project: {} });
  const at = (cxPct) => ({ enabled: true, cxPct, cyPct: 0.1, wPct: 0.1, opacity: 1 });
  assert.equal(fp(at(0.9)), fp(at(0.5)), 'moved');
  assert.equal(fp(at(0.9)), fp({ enabled: false }), 'switched off');
  // the geometry still has to REACH the concat, which is what logo-overlay.test.js proves below
  assert.notDeepEqual(resolveFinalOverlay(at(0.9)), resolveFinalOverlay(at(0.5)));
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

// The stamp follows the FRAME, not the caller's idea of the frame.
//
// `size` is the logical 1080-class canvas every caller passes (ratioToSize). A project with
// `resolutionScale: 2` renders its clips at double that and the concat never rescales them, so the
// finished file is 4K while logoRect was still being handed 1920×1080: half the width, at half the
// fraction. This was measured on a real finished video before it was fixed — a stamp stored at
// cx=0.936 (top right) drew at cx=0.468, dead centre, and a box drawn from the 1080-space
// prediction framed it exactly. Here the same mismatch is reproduced in miniature: clips twice the
// size the caller declares.
test('the logo follows the clips resolution, not the logical canvas', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p26s-'));
  const clip = join(dir, 'clip.mp4'), logo = join(dir, 'logo.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x003300:s=1280x720:d=2:r=30',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=100x100:d=1', '-frames:v', '1', logo]);
  const fo = { cxPct: 0.75, cyPct: 0.25, wPct: 0.2, opacity: 1 };
  const out = await concatScenes([clip], { title: 'scaled', outputDir: dir },
    // the caller declares the LOGICAL canvas, exactly as pipeline/context.js does
    { dir, size: { w: 640, h: 360 }, logo: { path: logo, ...fo }, transitions: false });
  const px = await grabFrame(out.path, 1.0, 1280, 720);
  const want = logoRect(fo, { W: 1280, H: 720, logoW: 100, logoH: 100 }); // {lw:256,lh:256,x:832,y:52}
  assert.deepEqual(want, { lw: 256, lh: 256, x: 832, y: 52 });
  const hit = px(want.x + 128, want.y + 128);
  assert.ok(hit.r > 180 && hit.g < 80, `stamp centre is red, got ${JSON.stringify(hit)}`);
  // …and NOT where the logical-canvas arithmetic used to put it: that rect was {lw:128,x:416,y:26},
  // i.e. cx 0.375 instead of 0.75. Its centre must be background now.
  const wrong = px(416 + 64, 26 + 64);
  assert.ok(wrong.r < 60 && wrong.g > 20, `nothing at the 1080-space centre, got ${JSON.stringify(wrong)}`);
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
