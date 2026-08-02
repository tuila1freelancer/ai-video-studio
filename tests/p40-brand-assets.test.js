// P40-B — brand-asset casting. Pins the contract that puts the channel's own artwork into
// scenes: the model may only pick REAL files, a mascot cutout keeps its alpha and is placed as a
// co-star (never a cropped hero), and the whole lane is opt-out and failure-tolerant.
// Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCharacterAsset, brandFolderFor, sanitizeCast, castBrandAssets, sceneMediaResolver } from '../src/pipeline/brand-assets.js';
import { imageFullBlock } from '../src/hyperframe/codegen.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const CATALOG = [
  { name: 'character ema thinking.png', path: '/tmp/a.png', character: true },
  { name: 'character ema smiling.png', path: '/tmp/b.png', character: true },
  { name: 'chart background.png', path: '/tmp/c.png', character: false },
];

test('P40-B: the reference naming scheme decides what is a mascot cutout', () => {
  assert.equal(isCharacterAsset('character ema crying.png'), true);
  assert.equal(isCharacterAsset('Character Ema Crying.PNG'), true);
  assert.equal(isCharacterAsset('chart background.png'), false);
  assert.equal(isCharacterAsset(''), false);
  assert.equal(isCharacterAsset(null), false);
});

test('P40-B: casting is on by default (Default folder) and explicitly opt-out', () => {
  assert.equal(brandFolderFor({}), 'Default', 'reference parity — a brand is always in play');
  assert.equal(brandFolderFor({ brandAssets: 'auto' }), 'Default');
  assert.equal(brandFolderFor({ brandAssets: 'The Money Uncle' }), 'The Money Uncle');
  assert.equal(brandFolderFor({ brandAssets: 'none' }), null);
  assert.equal(brandFolderFor({ brandAssets: false }), null);
});

test('P40-B: a cast can only ever name files that exist in the library', () => {
  const cast = sanitizeCast({
    1: ['character ema thinking.png'],
    2: ['character ema smiling'],           // extension dropped by the model
    3: ['a mascot that does not exist.png'], // hallucinated → dropped entirely
    4: ['chart background.png', 'character ema thinking.png', 'character ema smiling.png'], // over cap
    x: ['chart background.png'],             // non-numeric key → ignored
  }, CATALOG);
  assert.deepEqual(cast.get(1), ['character ema thinking.png']);
  assert.deepEqual(cast.get(2), ['character ema smiling.png'], 'forgiving filename match');
  assert.equal(cast.has(3), false, 'a hallucinated filename never reaches the render');
  assert.equal(cast.get(4).length, 2, 'at most 2 assets per scene');
  assert.equal(cast.has(NaN), false);
  assert.equal(sanitizeCast(null, CATALOG).size, 0);
  assert.equal(sanitizeCast({ 1: ['chart background.png'] }, []).size, 0, 'empty library → nothing cast');
});

test('P40-B: with no LLM the lane is a silent no-op, never a failure', async () => {
  const cast = await castBrandAssets({ scenes: [{ voice_text: 'xin chào' }], catalog: CATALOG, llm: { enabled: false } });
  assert.equal(cast.size, 0);
  assert.equal((await castBrandAssets({})).size, 0);
});

test('P40-B: the shared resolver keeps mascot alpha and turns off with imageFull', () => {
  const calls = [];
  const heroMediaUri = (path, opts) => { calls.push({ path, opts }); return `data:stub;${path}`; };
  const cfg = { assets: [{ name: 'shot.jpg', path: '/tmp/shot.jpg' }], brandAssets: 'none' };
  const resolve = sceneMediaResolver(cfg, { heroMediaUri });
  const media = resolve({ assets: ['shot.jpg'] });
  assert.equal(media.length, 1);
  assert.equal(media[0].character, false);
  assert.equal(calls[0].opts, undefined, 'a plain picture keeps the historic JPEG path');
  assert.equal(resolve({ assets: [] }), null);
  assert.equal(resolve({ assets: ['nope.png'] }), null, 'unknown name resolves to nothing');
  assert.equal(sceneMediaResolver({ hyperframe: { imageFull: false } }, { heroMediaUri })({ assets: ['shot.jpg'] }), null);
});

test('P40-B: a mascot is briefed as a co-star, a picture as the hero', () => {
  const charBlock = imageFullBlock([{ name: 'character ema smiling.png', character: true }]);
  assert.match(charBlock, /CO-STAR/, 'never the hero');
  assert.match(charBlock, /NO object-fit, NO crop/, 'a transparent cutout must not be cropped or boxed');
  assert.match(charBlock, /LEFT or RIGHT third/, 'placed beside the type');
  assert.ok(!charBlock.includes('CENTER HERO'), 'a cutout is not blown up to cover the frame');

  const picBlock = imageFullBlock([{ name: 'shot.jpg', character: false }]);
  assert.match(picBlock, /CENTER HERO/);
  assert.match(picBlock, /Ken Burns/);
  // legacy call shape (bare names) still works and reads as a picture
  assert.match(imageFullBlock(['shot.jpg']), /CENTER HERO/);
  assert.match(imageFullBlock([]), /SCENE MEDIA/);
});

test('P40-B: both codegen lanes resolve media through the same resolver', () => {
  assert.match(src('../src/pipeline/stages/visuals.js'), /sceneMediaResolver\(config, \{ heroMediaUri \}\)/, 'batch lane');
  assert.match(src('../src/pipeline/regen.js'), /sceneMediaResolver\(config, \{ heroMediaUri \}\)\(sc\)/, 'single-scene lane');
  assert.match(src('../src/util/asset-uri.js'), /alpha = false/, 'transparency-preserving inline path exists');
});
