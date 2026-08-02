// P40-D — AI-designed HTML thumbnail. Pins the sanitizer (a thumbnail is ONE static paint, so
// nothing may animate, execute or fetch) and the fallback contract (packaging never fails a
// render). Pure/fast: no browser, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeThumbFragment, generateThumbnailImage, renderThumbnailFragment } from '../src/pipeline/thumbnail-codegen.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('P40-D: a full document reply is reduced to a fragment', () => {
  const out = sanitizeThumbFragment('```html\n<!DOCTYPE html><html><head><style>.a{color:red}</style></head><body><div class="a">Xin chào</div></body></html>\n```');
  assert.ok(!/DOCTYPE|<html|<head|<body/i.test(out), 'document wrapper removed');
  assert.match(out, /<style>\.a\{color:red\}<\/style>/, 'the model CSS survives');
  assert.match(out, /Xin chào/, 'the content survives with diacritics intact');
});

test('P40-D: nothing that moves, executes or leaves the machine survives', () => {
  const dirty = `<style>@import url(https://evil/x.css); .a{animation: spin 2s infinite} @keyframes spin{from{opacity:0}to{opacity:1}}
  .b{background:url(https://cdn/x.png)}</style>
  <script>fetch('https://x')</script>
  <img src="https://cdn/pic.jpg" onerror="alert(1)"><iframe src="x"></iframe><div onclick="go()">Tiêu đề</div>`;
  const out = sanitizeThumbFragment(dirty);
  for (const bad of [/<script/i, /<iframe/i, /@import/i, /@keyframes/i, /\bonerror\s*=/i, /\bonclick\s*=/i, /https:\/\//]) {
    assert.ok(!bad.test(out), `${bad} must not survive: ${out}`);
  }
  assert.ok(!/animation\s*:/i.test(out), 'a still image cannot animate');
  assert.match(out, /Tiêu đề/, 'the visible text is kept');
});

test('P40-D: an empty or unusable reply yields nothing rather than a broken image', async () => {
  assert.equal(sanitizeThumbFragment(''), '');
  assert.equal(sanitizeThumbFragment(null), '');
  // no LLM configured → the lane declines and the caller falls back
  assert.equal(await generateThumbnailImage({ llm: { enabled: false }, size: { w: 1280, h: 720 } }), null);
});

test('P40-D: finalize tries the AI design first and always has a deterministic backup', () => {
  const f = src('../src/pipeline/stages/finalize.js');
  assert.match(f, /generateThumbnailImage\(/, 'AI lane wired in');
  assert.match(f, /const p = ai\?\.path \|\| await buildThumbnail\(/, 'deterministic builder is the fallback');
  assert.match(f, /if \(v === 0 && ai\?\.fragment\) thumbHtml = ai\.fragment/, 'the design markup is kept so it can be edited later');
  assert.match(f, /config\.thumbnailAi !== false/, 'the lane is opt-out');
});

test('P40-D: an edited design re-renders without paying for another generation', async () => {
  // renderThumbnailFragment is the split-out rasterizer behind /thumbnail/regen { html }
  assert.equal(await renderThumbnailFragment('', {}), null, 'empty markup renders nothing');
  assert.equal(await renderThumbnailFragment('<div>x</div>', {}), null, 'a scrap is not a design');
  const routes = src('../src/api/routes.js');
  assert.match(routes, /'\/projects\/:id\/thumbnail'/, 'the current thumbnail is inspectable');
  assert.match(routes, /'\/projects\/:id\/thumbnail\/regen'/, 'and can be re-designed or re-rendered');
  assert.match(routes, /renderThumbnailFragment\(html/, 'a hand-edited fragment skips the model');
  assert.match(routes, /generateThumbnailImage\(\{/, 'no html → a fresh design');
});

test('P40-D: the canvas geometry is INLINE, so a model restyling #content cannot collapse it', () => {
  // Regression: a real design wrote `#content { position: relative }`. The fragment's <style> is
  // parsed after the head stylesheet, so it won so the box lost its absolute inset, every
  // absolutely-positioned child stopped contributing height, and the render came out solid black.
  const s = src('../src/pipeline/thumbnail-codegen.js');
  assert.match(s, /const box = `position:absolute;top:\$\{inset\}px/, 'geometry is built as an inline style');
  assert.match(s, /<div id="content" style="\$\{box\}">/, 'and applied inline, where no author rule can beat it');
  assert.match(s, /<div id="stage" style="position:relative;width:\$\{w\}px/, 'the stage is pinned the same way');
  // the head stylesheet must NOT carry the geometry any more — that is exactly what got overridden
  const head = s.slice(s.indexOf('${fontsCss()}'), s.indexOf('</style></head>'));
  assert.ok(!/#content\s*\{/.test(head), 'no overridable #content rule left in the head');
  assert.ok(!/#stage\s*\{/.test(head), 'no overridable #stage rule left in the head');
});
