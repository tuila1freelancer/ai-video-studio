// Static lint for LLM-generated hyperframe specs — the pre-render gate that catches broken
// specs before a paid render/re-ask cycle. Ported findings from heygen-com/hyperframes'
// lint rules (see README.md, Appendix B).
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

// P39 (raw-GSAP reference port): the reference app's validation is advisory, so these
// quality/geometry nits are WARNINGS now, not errors — they no longer burn a codegen attempt.
test('lint: repeat:-1 is an advisory warning with a finite-count fix hint (P39)', () => {
  const r = ok("tl.to('#a',{x:10,duration:1,repeat:-1},0)");
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((e) => /repeat:-1/.test(e) && /finite/.test(e)), r.warnings.join('|'));
});

test('lint: animating display/visibility is an advisory warning; tl.set is clean (P39)', () => {
  const bad = ok("tl.to('#a',{display:'none',duration:.5},1)");
  assert.deepEqual(bad.errors, []);
  assert.ok(bad.warnings.some((e) => /display\/visibility/.test(e)));
  const good = ok("tl.set('#a',{display:'none'},3.2); tl.to('#a',{x:5,duration:.5},1)");
  assert.deepEqual(good.errors, []);
});

test('lint: width/height/top/left tweens are advisory warnings; transforms are clean (P39)', () => {
  const bad = ok("tl.to('.fill',{width:'100%',duration:.8,ease:'power3.inOut'},5)");
  assert.deepEqual(bad.errors, []);
  assert.ok(bad.warnings.some((e) => /width\/height\/top\/left/.test(e)));
  const good = ok("tl.set('.fill',{width:'0%'},0); tl.to('.fill',{scaleX:1,duration:.8},5)");
  assert.deepEqual(good.errors, []);
});

test('lint: getBoundingClientRect in an onUpdate callback is an advisory warning; at setup it is clean (P39)', () => {
  const bad = ok("tl.to('#a',{x:10,duration:1,onUpdate:function(){ const r=document.querySelector('#a').getBoundingClientRect(); }},0)");
  assert.deepEqual(bad.errors, []);
  assert.ok(bad.warnings.some((e) => /getBoundingClientRect/.test(e)));
  const good = ok("const r=document.querySelector('#a').getBoundingClientRect(); tl.to('#a',{x:r.width,duration:1},0)");
  assert.deepEqual(good.errors, []);
});

test('lint (P39): raw GSAP is the contract — gsap.set / gsap.timeline allowed, standalone gsap.to banned', () => {
  // full GSAP API for instant states + nested timelines added to tl → clean
  assert.deepEqual(ok("gsap.set('#a',{opacity:0}); var sub=gsap.timeline(); sub.to('#a',{opacity:1,duration:.5}); tl.add(sub,0)").errors, []);
  // a bare gsap.to() lands on the paused global timeline → frozen → still an error
  const bad = ok("gsap.to('#a',{x:10,duration:1})");
  assert.ok(bad.errors.some((e) => /standalone gsap tween|bare gsap\.to/.test(e)), bad.errors.join('|'));
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
