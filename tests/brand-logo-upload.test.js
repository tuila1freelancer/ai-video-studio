// The Brand Kit logo upload was broken in THREE independent ways at once, and the user's report
// — "I click upload and nothing even opens to pick a file" — pointed at the one that mattered
// most, which was not in the web app at all.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_SAFE, CONVERTIBLE } from '../src/api/services/image-convert.js';
import { sourceOf, indexHtml } from './_source.mjs';


test('logo: the native shell can actually open a file panel', () => {
  // ROOT CAUSE of "nothing happens when I click". WKWebView does NOT open a file picker on its
  // own — it asks its uiDelegate, and with no delegate the click is silently dropped: no panel,
  // no error, nothing in the console. Every <input type="file"> in the app was dead inside the
  // .app bundle while working fine in a browser, which is what disguised it as a web bug.
  const sw = sourceOf('shell/main.swift');
  assert.match(sw, /WKUIDelegate/, 'the delegate protocol is adopted');
  assert.match(sw, /webView\.uiDelegate = self/, 'and actually assigned — adopting alone does nothing');
  assert.match(sw, /runOpenPanelWith parameters: WKOpenPanelParameters/);
  assert.match(sw, /NSOpenPanel\(\)/);
  // the completion handler must fire on BOTH paths or the input stays stuck forever
  assert.match(sw, /completionHandler\(result == \.OK \? panel\.urls : nil\)/);
  // multi-select must follow what the page asked for (the library uploads take several files)
  assert.match(sw, /panel\.allowsMultipleSelection = parameters\.allowsMultipleSelection/);
});

test('logo: a failed upload is reported, never swallowed', () => {
  // api.upload THROWS on any non-2xx, so the old `if (r.error)` branch was unreachable: a
  // rejected file produced an unhandled rejection and the UI did nothing at all.
  const bk = sourceOf('public/js/features/brandkit.js');
  const handler = bk.slice(bk.indexOf("$('#brandLogoFile').addEventListener"), bk.indexOf("$('#brandSave')"));
  assert.match(handler, /try \{/, 'the upload is guarded');
  assert.match(handler, /catch \(err\) \{\s*toast\(`✖ Không tải được logo: \$\{err\.message\}`/);
  assert.ok(!/if \(r\.error\) return toast/.test(handler), 'the unreachable branch is gone');
  // a file input does not re-fire 'change' for the same value, so a retry after a failure needs
  // the value cleared — otherwise the user must pick a different file to try again
  assert.match(handler, /finally \{[\s\S]*e\.target\.value = ''/);
  // and the editor must be open, or brandDraft is null and the assignment throws
  assert.match(handler, /if \(!state\.brandDraft\) throw new Error/);
});

test('logo: the formats a Mac user actually has are accepted, not refused', () => {
  // HEIC is the default for macOS screenshots and iPhone photos; the picker offered image/* and
  // the server then rejected exactly those files.
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']) {
    assert.ok(WEB_SAFE.has(ext), `${ext} is stored as-is`);
  }
  for (const ext of ['.heic', '.heif', '.bmp', '.tif', '.tiff', '.avif']) {
    assert.ok(CONVERTIBLE.has(ext), `${ext} is converted, not rejected`);
    assert.ok(!WEB_SAFE.has(ext), `${ext} must not be stored raw — the renderer cannot read it`);
  }
  // the picker must offer exactly what the server accepts, or the two disagree again
  const html = indexHtml();
  const accept = /id="brandLogoFile" accept="([^"]+)"/.exec(html)?.[1] || '';
  for (const ext of [...WEB_SAFE, ...CONVERTIBLE]) {
    if (ext === '.ico') continue; // convertible, but not worth offering in the picker
    assert.ok(accept.includes(ext), `the picker offers ${ext}`);
  }
});

test('logo: conversion never silently produces an empty file', async () => {
  const conv = sourceOf('src/api/services/image-convert.js');
  // two engines because neither covers everything: the vendored ffmpeg has no HEIC decoder,
  // macOS sips does. Whichever runs, the OUTPUT is checked before the temp file is dropped.
  assert.match(conv, /existsSync\(dest\) && statSync\(dest\)\.size > 0/);
  assert.match(conv, /\/usr\/bin\/sips/);
  assert.match(conv, /PATHS\.ffmpeg/);
  assert.match(conv, /if \(!existsSync\(bin\)\) continue;/, 'a missing engine is skipped, not fatal');
  // an unknown format is a clear error, not a crash
  const { toPng } = await import('../src/api/services/image-convert.js');
  await assert.rejects(() => toPng('/tmp/x.txt', '/tmp/x.png', '.txt'), /không đọc được ảnh/);
});

test('logo: the stamp sits INSIDE the frame, not glued to the edge', async () => {
  const { logoRect, resolveFinalOverlay } = await import('../src/media/logo-overlay.js');
  // The shipped default (cyPct 0.08, wPct 0.085) put the logo's TOP EDGE 5px from the frame on a
  // 1080p video — visually touching. Geometry is centre-based, so a small cyPct with a large
  // logo silently glues it to the top.
  const glued = logoRect(resolveFinalOverlay({ enabled: true }), { W: 1920, H: 1080, logoW: 600, logoH: 600 });
  assert.ok(glued.y < 10, 'this is the trap the default falls into');

  // TheMoneyUncle's saved placement: a 144px square inset 58px from the top and right edges.
  const fo = resolveFinalOverlay({ enabled: true, cxPct: 0.9323, cyPct: 0.1204, wPct: 0.075, opacity: 0.95 });
  const r = logoRect(fo, { W: 1920, H: 1080, logoW: 600, logoH: 600 });
  assert.equal(r.lw, 144, 'small enough to read as a mark, not a picture');
  assert.equal(r.y, 58, 'a real gap above');
  assert.equal(1920 - (r.x + r.lw), 58, 'and the same gap to the right — an even inset');
  assert.ok(r.y > 0.04 * r.lh * 2 && r.y < 0.10 * 1080, 'near the top edge without touching it');
});
