// A finished video is a version, not a terminal state — and an edit says what it costs before
// the owner pays for it.
//
// Three things used to make "change one thing on a finished video" impossible to reason about:
// the resume button vanished on `done`, the brand kit was frozen at the snapshot taken when the
// project was created, and there was no way to know whether an edit meant one minute or one hour
// short of starting it and watching.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { recordStat } from '../src/pipeline/stats.js';


test('the resume button is reachable on a finished video, and says what it does there', () => {
  const studio = sourceOf('public/js/views/studio.js');
  // both places that compute visibility — the full render and the live WS status update
  const gates = studio.match(/\['paused', 'error', 'review', 'done'\]\.includes/g) || [];
  assert.equal(gates.length, 2, `expected both gates opened, found ${gates.length}`);
  assert.match(studio, /Áp dụng thay đổi/, 'relabelled — on a finished video it means something else');
  assert.match(studio, /state\.current\?\.status === 'done'\s*\?\s*openChangePlan\(\)/,
    'and it shows the cost first instead of just starting work');
});

test('the config panel can write back to an existing project', () => {
  // PUT /projects/:id has existed for a long time and no UI ever called it
  const cp = sourceOf('public/js/features/changeplan.js');
  assert.match(cp, /apply-changes/);
  assert.match(cp, /gatherConfig\(\)/, 'the panel\'s live values are what get saved');
  const routes = sourceOf('src/api/routes.js');
  assert.match(routes, /r\.post\('\/projects\/:id\/apply-changes'/);
  assert.match(routes, /DB\.updateProject\(p\.id, \{ config: \{ \.\.\.\(p\.config \|\| \{\}\), \.\.\.\(req\.body\?\.config \|\| \{\}\) \} \}\)/);
});

test('the brand kit is read live from the channel, not from a creation-time snapshot', () => {
  const fin = sourceOf('src/pipeline/stages/finalize.js');
  assert.match(fin, /if \(!config\.brandKitOverride\)/, 'unless the project overrode it on purpose');
  assert.match(fin, /DB\.channelOf\(projectId\)\?\.config\?\.brandKit/);
  assert.match(fin, /Nhận diện thương hiệu lấy trực tiếp từ kênh/, 'and says so when it differs');
});

test('the plan names every step, and never hides a costly one', () => {
  const plan = sourceOf('src/api/services/change-plan.js');
  // re-voicing spends real money; it must not read like the render row next to it
  assert.match(plan, /TỐN TIỀN API/);
  assert.match(plan, /costly: true/);
  const cp = sourceOf('public/js/features/changeplan.js');
  assert.match(cp, /item\.costly \? ';color:var\(--warn/);
  // and the cheap subset is offered whenever one exists, so "apply everything" is not the only door
  assert.match(cp, /cpCheap/);
  assert.match(cp, /Chỉ ghép lại/);
});

test('the plan says when its numbers are guesses', () => {
  const plan = sourceOf('src/api/services/change-plan.js');
  assert.match(plan, /const FALLBACK = \{ render: \d+, tts: \d+, concat: \d+ \}/);
  assert.match(plan, /measured/);
  const cp = sourceOf('public/js/features/changeplan.js');
  assert.match(cp, /chưa đo dự án này/, 'an unmeasured estimate must not pose as a measured one');
});

test('the fade is surfaced as the speed lever it is, not silently switched off', () => {
  const plan = sourceOf('src/api/services/change-plan.js');
  assert.match(plan, /fadeBlocksFastJoin/);
  const cp = sourceOf('public/js/features/changeplan.js');
  assert.match(cp, /gần như tức thì/, 'the offer is made');
  assert.ok(!/masterFade: false/.test(cp), 'but never taken on the owner\'s behalf');
});

test('timing stats reject nonsense rather than poisoning every later estimate', () => {
  // one bad sample would skew the cost table for every future edit, and a wrong number is worse
  // than an honest "chưa có số liệu"
  const stats = sourceOf('src/pipeline/stats.js');
  assert.match(stats, /const SANE = /);
  assert.match(stats, /s < range\[0\] \|\| s > range\[1\]/);
  // and it never takes a render down with it
  assert.match(stats, /catch \{ \/\* a timing statistic is never worth failing a render over \*\/ \}/);
  assert.doesNotThrow(() => recordStat('no-such-project', 'render', 12));
  assert.doesNotThrow(() => recordStat('no-such-project', 'render', -5));
  assert.doesNotThrow(() => recordStat('no-such-project', 'nonsense', 12));
});
