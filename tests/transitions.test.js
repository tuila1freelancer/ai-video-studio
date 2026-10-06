// Transition planning (P5): role-driven hero transitions above a short dip-through-black default
// hand-off, a uniform dip for role-less videos, and exact overlap accounting.
//
// The numbers below are frozen deliberately. They are a doctrine, arrived at by rendering real
// adjacent clips and looking at the middle of the blend — a dissolve superimposes the outgoing
// clip's held climax on the incoming clip's entrances, and getting LONGER makes that worse, not
// smoother. If one of these fails, decide whether the doctrine changed; do not widen it to a range.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { readFileSync } from 'node:fs';
import { MAX_GRAPH_CLIPS, planTransitions, transitionLoss } from '../src/pipeline/render.js';

const sc = (role, template) => ({ visual_prompt: role ? `[ROLE] ${role}\n[MAIN FOCUS] x` : '[MAIN FOCUS] x', template: template || 'hyperframe' });

test('planTransitions: role-driven — a short dip by default, zoomin into payoff, longer dip into cta/outro', () => {
  const scenes = [sc('hook'), sc('problem'), sc('insight'), sc('payoff'), sc('cta')];
  const plan = planTransitions({ scenes, clipCount: 6, nIntro: 0, nOutro: 1 }); // + outro card
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((t) => t.type), ['fadeblack', 'fadeblack', 'zoomin', 'fadeblack', 'fadeblack']);
  assert.equal(plan[0].dur, 0.35); // the ordinary hand-off — short enough to read as a soft cut
  assert.ok(plan[2].dur > plan[0].dur); // the one hero transition still punches above it
  // 0.45 is the ceiling: leading silence in a clip is ~0.19s and programCues puts the incoming
  // scene's first cue there, so a longer window drifts the dark point under a lit caption
  assert.ok(plan.every((t) => t.dur <= 0.45));
});

test('planTransitions: at most ONE zoom-through per video; chapter-breaks get a fade', () => {
  const scenes = [sc('hook'), sc('payoff'), sc(null, 'chapter-break'), sc('payoff')];
  scenes[2].visual_prompt = '[ROLE] step\n[MAIN FOCUS] x'; // role present, template wins
  const plan = planTransitions({ scenes, clipCount: 4 });
  assert.deepEqual(plan.map((t) => t.type), ['zoomin', 'fadeblack', 'fadeblack']);
  assert.deepEqual(plan.map((t) => t.dur), [0.45, 0.45, 0.35]); // hero zoom · chapter dip · default dip
});

test('planTransitions: no roles anywhere → one uniform dip (the checkbox keeps its old meaning)', () => {
  const scenes = [sc(null), sc(null), sc(null)];
  scenes.forEach((s) => { s.visual_prompt = 'plain brief'; });
  const plan = planTransitions({ scenes, clipCount: 3 });
  assert.deepEqual(plan.map((t) => t.type), ['fadeblack', 'fadeblack']);
  assert.equal(plan[0].dur, 0.4);
});

test('transitionLoss: cuts cost nothing, blends cost their duration; prefix sums are exact', () => {
  const plan = [{ type: 'cut', dur: 0 }, { type: 'zoomin', dur: 0.45 }, { type: 'fadeblack', dur: 0.5 }];
  assert.equal(transitionLoss(plan), 0.95);
  assert.equal(transitionLoss(plan, 1), 0);
  assert.equal(transitionLoss(plan, 2), 0.45);
});

test('the transition graph is not capped at a clip count real videos exceed', () => {
  // The cap was 24. Every long-form video this app makes is over it — 42, 45, 72, 95, 105, 129,
  // 130 and 203 scenes among the finished projects — so `transitions: true` was computed,
  // fingerprinted, charged for, and then silently not rendered on all of them. The stated reason
  // was decoder exhaustion; measured, 192 clips join in 77s at a 2.6 GB peak and exit clean.
  assert.ok(MAX_GRAPH_CLIPS >= 200, 'the ceiling is a backstop, not a working limit');
  const src = sourceOf('src/pipeline/render.js');
  assert.match(src, /const useGraph = anyBlend && sceneVideos\.length > 1 && sceneVideos\.length <= MAX_GRAPH_CLIPS;/);
  // …and it exists in exactly one place. Three copies had drifted apart: the renderer skipped the
  // blend above 24 clips while finalize's SFX offsets assumed it ran, which placed every effect
  // 0.2s × k early — forty seconds of drift by scene 200.
  for (const f of ['../src/pipeline/stages/finalize.js', '../src/api/routes.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /length <= 24|clipCount <= 24|clips\.length <= 24/);
  }
});

test('the fingerprint describes the join that will actually happen', () => {
  // A plan the graph will not execute must not move the digest, or the user pays for a re-encode
  // that produces identical pixels — which is exactly what changing the transition style did on a
  // capped video.
  const src = sourceOf('src/pipeline/render.js');
  assert.match(src, /const effPlan = useGraph \? plan : null;/);
  assert.match(src, /concatFingerprint\(\{\s*\n\s*clips: sceneVideos, size, frame: \{ w: fw, h: fh \}, fps: ffps, transitions: effPlan,/);
  assert.match(src, /needsVideoFilter\(\{ logo, watermark, assText, transitions: effPlan, masterFade \}\)/);
});

test('the audio seam is equal-power out and does not fade the incoming voice up', () => {
  // acrossfade defaults to linear on both sides: ~3 dB power dip at the midpoint. And the material
  // is asymmetric — the outgoing clip ends in 0.68–0.93s of breath pad while the incoming one has
  // only 0.19–0.20s of leading silence, so fading it in ate the first words of every scene.
  assert.match(sourceOf('src/pipeline/render.js'),
    /acrossfade=d=\$\{d\.toFixed\(3\)\}:c1=qsin:c2=nofade/);
});

test('the final frame rate follows the clips, so a 60fps project stays 60fps', () => {
  // The encoder ran at a constant 30 while the scenes rendered at config.fps: a 60fps project paid
  // double the render time and shipped a 30fps file, and the fps control in the UI did nothing.
  const src = sourceOf('src/pipeline/render.js');
  assert.match(src, /const ffps = \(await probeFrameRate\(sceneVideos\[0\]\)\) \|\| FPS;/);
  assert.match(src, /videoCodecArgs\(encoder, ffps\)/);
  assert.match(src, /function videoCodecArgs\(encoder, fps = FPS\)/);
  assert.match(src, /'-pix_fmt', 'yuv420p', '-r', String\(fps\)\]/);
  assert.doesNotMatch(src, /String\(FPS\)\]/, 'no path re-encodes at the hardcoded rate');
  assert.match(sourceOf('src/media/ffmpeg.js'),
    /export async function probeFrameRate/);
});
