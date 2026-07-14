// Transition planning (P5): role-driven hero transitions with hard cuts as the default,
// legacy uniform fade for role-less videos, and exact overlap accounting.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransitions, transitionLoss } from '../src/pipeline/render.js';

const sc = (role, template) => ({ visual_prompt: role ? `[ROLE] ${role}\n[MAIN FOCUS] x` : '[MAIN FOCUS] x', template: template || 'hyperframe' });

test('planTransitions: role-driven — cuts by default, zoomin into payoff, fadeblack into cta/outro', () => {
  const scenes = [sc('hook'), sc('problem'), sc('insight'), sc('payoff'), sc('cta')];
  const plan = planTransitions({ scenes, clipCount: 6, nIntro: 0, nOutro: 1 }); // + outro card
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((t) => t.type), ['cut', 'cut', 'zoomin', 'fadeblack', 'fadeblack']);
});

test('planTransitions: at most ONE zoom-through per video; chapter-breaks get a fade', () => {
  const scenes = [sc('hook'), sc('payoff'), sc(null, 'chapter-break'), sc('payoff')];
  scenes[2].visual_prompt = '[ROLE] step\n[MAIN FOCUS] x'; // role present, template wins
  const plan = planTransitions({ scenes, clipCount: 4 });
  assert.deepEqual(plan.map((t) => t.type), ['zoomin', 'fade', 'cut']);
});

test('planTransitions: no roles anywhere → legacy uniform fade (the checkbox keeps its old meaning)', () => {
  const scenes = [sc(null), sc(null), sc(null)];
  scenes.forEach((s) => { s.visual_prompt = 'plain brief'; });
  const plan = planTransitions({ scenes, clipCount: 3 });
  assert.deepEqual(plan.map((t) => t.type), ['fade', 'fade']);
  assert.equal(plan[0].dur, 0.5);
});

test('transitionLoss: cuts cost nothing, blends cost their duration; prefix sums are exact', () => {
  const plan = [{ type: 'cut', dur: 0 }, { type: 'zoomin', dur: 0.45 }, { type: 'fadeblack', dur: 0.5 }];
  assert.equal(transitionLoss(plan), 0.95);
  assert.equal(transitionLoss(plan, 1), 0);
  assert.equal(transitionLoss(plan, 2), 0.45);
});
