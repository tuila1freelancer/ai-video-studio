// P37 — reference-parity codegen: the prompt now hands the model concrete ANIMATION_SPEC +
// TIMELINE_SKELETON values in OUR tl.*/FX.* vocabulary (never raw gsap.*), and the caliber gates
// are relaxed to first-3-attempt nudges (softDefects) so a scene that cleared every HARD
// readability gate is not homogenized toward one dense look.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { animationSpecBlock, timelineSkeletonBlock } from '../src/hyperframe/prompt.js';
import { motionSignature } from '../src/hyperframe/signatures.js';
import { cinematicDirection, extractBeats } from '../src/hyperframe/beats.js';
import { lintSpec } from '../src/hyperframe/lint.js';

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

// realistic cue stream so extractBeats returns several labeled beats (every 6th word a number)
const cues = [{ start: 0, end: 8, text: 'x', words: Array.from({ length: 24 }, (_, i) => ({
  start: (i * 8) / 24, end: ((i + 1) * 8) / 24, word: i % 6 === 0 ? String(10 + i) : `chu${i}` })) }];

test('P37 animationSpecBlock: concrete FX.* values, never raw gsap.*', () => {
  const dir = cinematicDirection({ voice_text: 'Bùng nổ tăng vọt kỷ lục', duration: 8 }, 0, 10); // hook → high energy
  const sig = motionSignature(dir, 0, 0);
  const spec = animationSpecBlock(dir, sig, extractBeats(cues, [], 8), 8);
  assert.match(spec, /FX\.camPush\(tl, \{[^}]*scale/, 'camera is a concrete FX.camPush with a scale/pan value');
  assert.match(spec, /FX\.beat\(tl,/, 'entry uses FX.beat');
  assert.match(spec, /FX\.pulseGlow\(tl,/, 'pulse uses FX.pulseGlow');
  assert.match(spec, /FX\.beamSweep\(tl,/, 'beam cadence present');
  assert.match(spec, /FX\.impact\(tl,/, 'climax uses FX.impact');
  assert.ok(!/gsap\.\w+\(/.test(spec), 'the spec never suggests a raw gsap.<method>() call (the prohibition text may still say "gsap.*")');
  assert.match(spec, /HARNESS-OWNED/, 'grain/vignette/scanlines are marked harness-owned');
});

test('P37 timelineSkeletonBlock: t=0-empty + one authored line per beat + climax-to-DUR', () => {
  const dir = cinematicDirection({ voice_text: 'Một kết luận quan trọng', duration: 8 }, 9, 10); // climax scene
  const beats = extractBeats(cues, [], 8);
  const tl = timelineSkeletonBlock(beats, dir, 8);
  assert.match(tl, /t=0\.00s — the frame is NEARLY EMPTY/, 'opens on a near-empty frame');
  assert.match(tl, /CLIMAX/, 'names the climax');
  assert.match(tl, /HOLD to DUR=8/, 'holds the climax to DUR');
  const beatLines = (tl.match(/FX\.beat\(tl,/g) || []).length;
  assert.ok(beatLines >= beats.length && beatLines >= 1, `one authored FX.beat line per beat (${beatLines} vs ${beats.length})`);
});

test('P37 the emitted spec calls are LINT-CLEAN (the prompt never suggests a banned pattern)', () => {
  const dir = cinematicDirection({ voice_text: 'Tăng vọt 42% kỷ lục', duration: 8 }, 3, 10);
  const sig = motionSignature(dir, 3, 0);
  const beats = extractBeats(cues, [], 8);
  const blocks = `${animationSpecBlock(dir, sig, beats, 8)}\n${timelineSkeletonBlock(beats, dir, 8)}`;
  // extract every FX.*( … ) / tl.*( … ) call the prompt literally suggests, resolve the
  // <placeholder> selectors + <t> times to concrete safe values, and lint them as a script.
  const calls = (blocks.match(/(?:FX|tl)\.[A-Za-z]+\([^\n;]*\)/g) || [])
    .map((c) => c.replace(/'<[^']*>'/g, "'#el'").replace(/<[^>]*>/g, '1'));
  assert.ok(calls.length >= 3, `extracted several FX/tl calls to lint (${calls.length})`);
  const script = calls.map((c) => `${c};`).join('\n');
  const { errors } = lintSpec({ css: '', html: '<div class="hf-slot"><div class="hf-kw" id="el">X</div></div>', script }, {});
  assert.deepEqual(errors, [], `emitted spec calls must lint clean, got: ${errors.join(' | ')}`);
});

test('P37 soft-gate split: the caliber gates nudge via softDefects; codegen re-asks them only in the first 3 attempts', () => {
  const v = src('../src/hyperframe/validate.js');
  assert.match(v, /const softDefects = \[\]/, 'validate has a softDefects lane');
  assert.match(v, /return \{ ok: defects\.length === 0, defects, softDefects/, 'ok reflects only HARD defects; softDefects are returned separately');
  // each push statement is a single source line, so the line carrying the finding IS its push.
  const lineWith = (needle) => {
    const i = v.indexOf(needle); if (i < 0) return '';
    const a = v.lastIndexOf('\n', i) + 1; const b = v.indexOf('\n', i);
    return v.slice(a, b < 0 ? undefined : b);
  };
  // the four caliber findings push to softDefects, never to the HARD `defects`
  for (const nudge of ['reads sparse', 'crafted sub-parts', 'produce no visual response', 'the spoken anchor words']) {
    assert.match(lineWith(nudge), /softDefects\.push\(/, `"${nudge}" must be a soft nudge (softDefects.push), not a HARD defect`);
  }
  // the HARD readability gates STAY in `defects` (a source-anchored sample)
  for (const hard of ['px off-screen', 'reserved for subtitles', 'is unreadable at', 'overlap each other']) {
    const l = lineWith(hard);
    assert.ok(l && /defects\.push\(/.test(l) && !/softDefects\.push\(/.test(l), `"${hard}" must stay a HARD defect`);
  }
  const c = src('../src/hyperframe/codegen.js');
  assert.match(c, /attempt <= 3 \? softDefects : \[\]/, 'codegen re-asks softDefects only in the first 3 attempts');
});
