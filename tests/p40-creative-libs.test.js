// P40-A — creative runtime libraries. Pins the contract that lets a scene reach for three.js /
// p5.js while the render stays deterministic: detection is opt-in per scene, the harness injects
// only what is referenced, window.__onSeek is the single public hook, and headless Chrome is
// launched with software WebGL. Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { LIBS, detectLibs, availableLibs, advertisedLibs, libsBundle } from '../src/animation/libs.js';
import { creativeLibsBlock } from '../src/hyperframe/prompt.js';
import { lintSpec } from '../src/hyperframe/lint.js';


test('P40-A: libraries are detected from real usage only — prose never pulls in a 600 KB bundle', () => {
  assert.deepEqual(detectLibs({ script: 'var r = new THREE.WebGLRenderer({});' }), ['three']);
  assert.deepEqual(detectLibs({ script: 'var s = new p5(function(k){}, host);' }), ['p5']);
  // the words alone must not trigger an injection
  assert.deepEqual(detectLibs({ script: 'tl.to("#a",{x:1})', html: '<div>three ways to p5 growth</div>' }), []);
  assert.deepEqual(detectLibs({}), []);
  assert.deepEqual(detectLibs(null), []);
});

test('P40-A: only scrubbable libraries are advertised; the rest stay vendored but silent', () => {
  const adv = advertisedLibs(), avail = availableLibs();
  for (const id of adv) assert.ok(avail.includes(id), `${id} advertised but not vendored`);
  // tsParticles/countUp own their own rAF clock — vendoring keeps an import from 404ing, but the
  // model is never told about them, because the renderer scrubs a paused timeline.
  for (const id of ['tsparticles', 'countup', 'scrolltrigger', 'cssrule']) {
    assert.ok(!adv.includes(id), `${id} must not be advertised (not deterministically scrubbable)`);
  }
  assert.ok(LIBS.every((l) => l.id && l.file && l.probe instanceof RegExp), 'registry shape');
});

test('P40-A: the prompt block teaches the seek hook and degrades to nothing without vendored libs', () => {
  assert.equal(creativeLibsBlock([]), '', 'no vendored libraries → no offer in the prompt');
  const block = creativeLibsBlock(['three', 'p5']);
  assert.match(block, /__onSeek/, 'the deterministic redraw hook is taught');
  assert.match(block, /Do NOT call requestAnimationFrame/, 'the rAF ban is explicit');
  assert.match(block, /INSTANCE MODE only/, 'p5 must not use the global sketch/draw loop');
  assert.ok(!creativeLibsBlock(['p5']).includes('three.js'), 'a library that is not vendored is not offered');
});

test('P40-A: window.__onSeek is the ONE public harness entry point', () => {
  const base = { html: '<div id="a">x</div>', script: 'tl.to("#a",{x:1});' };
  const hooked = lintSpec({ ...base, script: 'window.__onSeek(function(t){});\ntl.to("#a",{x:1});' });
  assert.deepEqual(hooked.errors, [], 'registering a seek hook is allowed');
  const poked = lintSpec({ ...base, script: 'window.__tl.pause();' });
  assert.ok(poked.errors.some((e) => /harness internal runtime/.test(e)), 'other harness internals stay banned');
  // a library layer with no hook renders frame 0 and then holds — warn, never block
  const noHook = lintSpec({ ...base, script: 'var r = new THREE.WebGLRenderer({});\ntl.to("#a",{x:1});' });
  assert.deepEqual(noHook.errors, [], 'a missing hook is advisory, not a hard failure');
  assert.ok(noHook.warnings.some((w) => /__onSeek/.test(w)), 'missing hook is warned about');
});

test('P40-A: the harness injects only referenced libraries, and Chrome runs software WebGL', () => {
  const harness = sourceOf('src/animation/harness.js');
  assert.match(harness, /const libIds = Array\.isArray\(opts\.libs\) \? opts\.libs : detectLibs\(template\)/, 'per-scene detection');
  assert.match(harness, /window\.__onSeek = /, 'the hook is defined before the template script builds');
  assert.match(harness, /window\.__runSeekHooks\(t, st\)/, 'hooks run on every seek');
  const pptr = sourceOf('src/media/puppeteer.js');
  assert.match(pptr, /--use-angle=swiftshader/, 'software WebGL so a three.js layer can render headless');
  assert.match(pptr, /--enable-unsafe-swiftshader/);
});

test('P40-A: bundling escapes a nested </script> so the inline tag cannot be terminated early', () => {
  const bundle = libsBundle(availableLibs().slice(0, 1));
  assert.ok(!/<\/script/i.test(bundle), 'no raw </script in the emitted bundle');
  assert.equal(libsBundle([]), '', 'nothing requested → nothing emitted');
  assert.equal(libsBundle(['not-a-lib']), '', 'unknown id is ignored');
});
