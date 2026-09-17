// P37 — reference-parity codegen: the prompt now hands the model concrete ANIMATION_SPEC +
// TIMELINE_SKELETON values in OUR tl.*/FX.* vocabulary (never raw gsap.*), and the caliber gates
// are relaxed to first-3-attempt nudges (softDefects) so a scene that cleared every HARD
// readability gate is not homogenized toward one dense look.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { animationSpecBlock, timelineSkeletonBlock } from '../src/hyperframe/prompt.js';
import { motionSignature } from '../src/hyperframe/signatures.js';
import { cinematicDirection, extractBeats } from '../src/hyperframe/beats.js';
import { lintSpec } from '../src/hyperframe/lint.js';


// realistic cue stream so extractBeats returns several labeled beats (every 6th word a number)
const cues = [{ start: 0, end: 8, text: 'x', words: Array.from({ length: 24 }, (_, i) => ({
  start: (i * 8) / 24, end: ((i + 1) * 8) / 24, word: i % 6 === 0 ? String(10 + i) : `chu${i}` })) }];

test('P37/P39 animationSpecBlock: concrete FX.*(tl,…) values; motion stays on tl', () => {
  const dir = cinematicDirection({ voice_text: 'Bùng nổ tăng vọt kỷ lục', duration: 8 }, 0, 10); // hook → high energy
  const sig = motionSignature(dir, 0, 0);
  const spec = animationSpecBlock(dir, sig, extractBeats(cues, [], 8), 8);
  assert.match(spec, /FX\.camPush\(tl, \{[^}]*scale/, 'camera is a concrete FX.camPush with a scale/pan value');
  assert.match(spec, /FX\.beat\(tl,/, 'entry uses FX.beat');
  assert.match(spec, /FX\.pulseGlow\(tl,/, 'pulse uses FX.pulseGlow');
  assert.match(spec, /FX\.beamSweep\(tl,/, 'beam cadence present');
  assert.match(spec, /FX\.impact\(tl,/, 'climax uses FX.impact');
  // P39: raw GSAP is allowed now, but every SUGGESTED call still targets tl / FX.* — the only
  // gsap.* mention is the caution that a bare gsap.to() freezes; none is suggested as vocabulary.
  assert.ok(!/gsap\.\w+\(\s*tl\b/.test(spec), 'never suggests a gsap.method(tl, …) call — motion goes through FX.*/tl.*');
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

test('P39 render gate: structural floor is HARD (defects), geometry is advisory (warnings)', () => {
  const v = sourceOf('src/hyperframe/validate.js');
  assert.ok(!/softDefects/.test(v), 'the softDefects lane is removed');
  assert.match(v, /return \{ ok: defects\.length === 0, defects, warnings, langDefects, tlDur/, 'the gate returns defects (hard floor) + warnings (advisory) + langDefects (caller decides)');
  // each push statement is a single source line, so the line carrying the finding IS its push.
  const lineWith = (needle) => {
    const i = v.indexOf(needle); if (i < 0) return '';
    const a = v.lastIndexOf('\n', i) + 1; const b = v.indexOf('\n', i);
    return v.slice(a, b < 0 ? undefined : b);
  };
  // the STRUCTURAL FLOOR (renders blank / script threw) is the ONLY thing that pushes to `defects`
  for (const hard of ['no element is ever visible', 'your script threw at runtime']) {
    const l = lineWith(hard);
    assert.ok(l && /defects\.push\(/.test(l), `"${hard}" must be a HARD structural defect`);
  }
  // every GEOMETRY finding is ADVISORY → warnings.push (reference-parity: validation advisory)
  for (const soft of ['px off-screen', 'reserved for subtitles', 'stacked on the center axis', 'overlap each other', 'is clipped']) {
    const l = lineWith(soft);
    assert.ok(l && /warnings\.push\(/.test(l), `"${soft}" must be an advisory warning`);
  }
  // WRONG LANGUAGE is the documented exception to P39's advisory doctrine, and it goes in its own
  // bucket rather than into `defects`: renderValidate is stateless and is also called by the
  // manual scene-edit lane and by repurpose, neither of which has an attempt loop. codegen.js
  // decides how many attempts it may burn. Advisory cost this its exemption — on a 95-scene
  // English video it fired 22 times and all 22 scenes shipped with Vietnamese text on screen.
  assert.match(lineWith('wrong language'), /langDefects\.push\(/, 'language findings are their own bucket');
  const c = sourceOf('src/hyperframe/codegen.js');
  assert.match(c, /const LANG_REASK_MAX = 3;/, 'bounded — a scene is worth more than a perfect one');
  assert.match(c, /attempt <= LANG_REASK_MAX\) renderDefects = \[\.\.\.renderDefects, \.\.\.renderLangDefects\]/);
  assert.match(c, /vẫn sai ngôn ngữ sau \$\{LANG_REASK_MAX\} lần thử/, 'the downgrade is never silent');
  // the caliber / contrast nudges are removed entirely (the reference app ships none of them)
  for (const gone of ['reads sparse', 'crafted sub-parts', 'produce no visual response', 'the spoken anchor words', 'is unreadable at']) {
    assert.ok(!v.includes(gone), `"${gone}" caliber/contrast nudge is removed`);
  }
});
