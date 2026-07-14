// Static lint for LLM-generated hyperframe specs — the pre-render gate that catches broken
// specs before a paid render/re-ask cycle. Ported findings from heygen-com/hyperframes'
// lint rules (see docs/reference/hyperframes-notes.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSpec } from '../src/hyperframe/lint.js';
import { SAMPLE_SPEC } from '../src/styleguide/guide.js';

const BASE = { css: '.x{color:#fff}', html: '<div class="hf-layer hf-near"><div id="a" class="hf-kw">OK</div></div>' };
const ok = (script) => lintSpec({ ...BASE, script });

test('lint: the canned SAMPLE_SPEC passes clean', () => {
  const { errors } = lintSpec(SAMPLE_SPEC);
  assert.deepEqual(errors, []);
});

test('lint: repeat:-1 is an error with a floor-formula fix hint', () => {
  const { errors } = ok("tl.to('#a',{x:10,duration:1,repeat:-1},0)");
  assert.ok(errors.some((e) => /repeat:-1/.test(e) && /floor/.test(e)), errors.join('|'));
});

test('lint: ANIMATING display/visibility is an error, tl.set of display is legal', () => {
  const bad = ok("tl.to('#a',{display:'none',duration:.5},1)");
  assert.ok(bad.errors.some((e) => /display\/visibility/.test(e)));
  const good = ok("tl.set('#a',{display:'none'},3.2); tl.to('#a',{x:5,duration:.5},1)");
  assert.deepEqual(good.errors, []);
});

test('lint: width/height/top/left tweens are errors, transforms are fine', () => {
  const bad = ok("tl.to('.fill',{width:'100%',duration:.8,ease:'power3.inOut'},5)");
  assert.ok(bad.errors.some((e) => /width\/height\/top\/left/.test(e)));
  const good = ok("tl.set('.fill',{width:'0%'},0); tl.to('.fill',{scaleX:1,duration:.8},5)");
  assert.deepEqual(good.errors, []);
});

test('lint: getBoundingClientRect in an onUpdate callback is an error, at setup it is allowed', () => {
  const bad = ok("tl.to('#a',{x:10,duration:1,onUpdate:function(){ const r=document.querySelector('#a').getBoundingClientRect(); }},0)");
  assert.ok(bad.errors.some((e) => /getBoundingClientRect/.test(e)));
  const good = ok("const r=document.querySelector('#a').getBoundingClientRect(); tl.to('#a',{x:r.width,duration:1},0)");
  assert.deepEqual(good.errors, []);
});

test('lint: duplicate html ids are an error', () => {
  const { errors } = lintSpec({ ...BASE, html: '<div id="kw">A</div><span id="kw">B</span>', script: "tl.to('#kw',{x:1,duration:1},0)" });
  assert.ok(errors.some((e) => /duplicate id/.test(e) && /kw/.test(e)));
});

test('lint: infinite CSS animation is an error', () => {
  const { errors } = lintSpec({ css: '.p{animation: spin 2s linear infinite}', html: BASE.html, script: "tl.to('#a',{x:1,duration:1},0)" });
  assert.ok(errors.some((e) => /infinite CSS animation/.test(e)));
});

test('lint: addEventListener is an error', () => {
  const { errors } = ok("document.addEventListener('click',()=>{}); tl.to('#a',{x:1,duration:1},0)");
  assert.ok(errors.some((e) => /addEventListener/.test(e)));
});

test('lint: <br> and from({opacity:1}) are warnings, not errors', () => {
  const r = lintSpec({ css: '', html: '<div id="a">line<br>two</div>', script: "tl.from('#a',{opacity:1,duration:.5},0)" });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /<br>/.test(w)));
  assert.ok(r.warnings.some((w) => /no-op/.test(w)));
});
