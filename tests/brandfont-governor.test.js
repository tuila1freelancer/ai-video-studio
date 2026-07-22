// F1 brand-font system + F3 adaptive governor — pure/repo-level invariants.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('adaptiveCap: shrinks under memory/load pressure, never below 1 or above base', async () => {
  const { adaptiveCap } = await import('../src/pipeline/governor.js');
  const cores = 8;
  const GB = 1073741824;
  assert.equal(adaptiveCap(4, { freeBytes: 16 * GB, load1: 2, cores }), 4, 'healthy machine keeps base');
  assert.equal(adaptiveCap(4, { freeBytes: 2 * GB, load1: 2, cores }), 2, '<3GB free → cap 2');
  assert.equal(adaptiveCap(4, { freeBytes: 1 * GB, load1: 2, cores }), 1, '<1.5GB free → cap 1');
  assert.equal(adaptiveCap(4, { freeBytes: 16 * GB, load1: 20, cores }), 3, 'overload sheds one');
  assert.equal(adaptiveCap(1, { freeBytes: 0.5 * GB, load1: 99, cores }), 1, 'never below 1');
  assert.equal(adaptiveCap(2, { freeBytes: 2 * GB, load1: 20, cores }), 1, 'pressure combines but floors at 1');
});

test('brandFontStack: sanitized family leads, Vietnamese-safe fallback follows', async () => {
  const { brandFontStack } = await import('../src/animation/index.js');
  assert.equal(brandFontStack({ fonts: { display: 'Oswald' } }), `'Oswald', 'Be Vietnam Pro', sans-serif`);
  assert.equal(brandFontStack({ fonts: { display: ` My"Brand'<i>` } }), `'MyBrandi', 'Be Vietnam Pro', sans-serif`, 'quotes/angle brackets stripped');
  assert.equal(brandFontStack({}), null);
  assert.equal(brandFontStack({ fonts: { display: '  ' } }), null);
});

test('userfonts: uploaded rows become @font-face CSS + families list (vendored + uploaded)', async () => {
  const DB = await import('../src/db/index.js');
  const { DIRS } = await import('../src/config/paths.js');
  const { userFontsCss, fontFamilies, familyOf } = await import('../src/animation/userfonts.js');
  // a REAL ttf from the vendored set, registered under a custom family name
  const src = join(ROOT, 'vendor', 'fonts', 'ttf');
  const anyTtf = existsSync(src) ? (await import('node:fs')).readdirSync(src).find((f) => f.endsWith('.ttf')) : null;
  if (!anyTtf) return; // dev checkout without vendored fonts — nothing to assert
  mkdirSync(DIRS.font, { recursive: true });
  const dest = join(DIRS.font, 'TestBrandFont.ttf');
  copyFileSync(join(src, anyTtf), dest);
  const row = DB.addLibrary({ kind: 'font', brandFolder: 'Default', name: 'TestBrandFont.ttf', filename: 'TestBrandFont.ttf', path: dest, size: 1000 });
  assert.equal(familyOf(row), 'TestBrandFont');
  const css = userFontsCss();
  assert.match(css, /@font-face\{font-family:'TestBrandFont';src:url\(data:font\/ttf;base64,/);
  assert.match(css, /format\('truetype'\)/);
  const { families } = fontFamilies();
  assert.ok(families.some((f) => f.name === 'TestBrandFont' && f.source === 'uploaded'));
  assert.ok(families.some((f) => f.source === 'vendored'), 'vendored families parsed from fonts.css');
});

test('scene page carries the uploaded font and the display override reaches hf-kw CSS', async () => {
  const { buildSceneHtml } = await import('../src/animation/index.js');
  // The brand display font is injected into the hyperframe scene's style guide (applyBrandFont),
  // so it reaches the .hf-kw hero typography — the guide is what carries fonts into HyperFrame.
  const scene = {
    idx: 0, voice_text: 'Xin chào', srt_json: [], duration: 4,
    template: 'hyperframe', props: { css: '', html: '', script: '', guide: {}, beats: [] },
  };
  const project = { aspect_ratio: '9:16', title: 'Font test' };
  const html = buildSceneHtml(scene, project, { visualMode: 'hyperframe', fonts: { display: 'TestBrandFont' } }, {});
  assert.match(html, /\.hf-kw\{font-family:'TestBrandFont', 'Be Vietnam Pro', sans-serif/, 'brand display font reaches hf-kw CSS');
});
