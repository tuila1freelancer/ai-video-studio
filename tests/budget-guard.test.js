import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { budgetSettings, spendState } from '../src/core/budget.js';
import { assertSpendAllowed, resetSpendCache } from '../src/core/spend-guard.js';
import { classifyError } from '../src/core/errors.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

const ch = DB.createChannel({ name: 'Budget' });
const spend = (projectId, usd) => DB.recordUsageRow({ projectId, channelId: ch.id, kind: 'llm', estCost: usd });
const newProject = () => DB.createProject({ title: 'b', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {}, channelId: ch.id });

test('with no caps set, nothing is capped and nothing is refused', () => {
  DB.setSetting('budget', {});
  resetSpendCache();
  assert.equal(budgetSettings().hardStop, false);
  const p = newProject();
  spend(p.id, 5);
  const state = spendState({ projectId: p.id, channelId: ch.id });
  assert.deepEqual(state.over, []);
  assert.doesNotThrow(() => assertSpendAllowed({ projectId: p.id, channelId: ch.id }));
});

test('a per-video cap without hardStop still only downgrades — the old behaviour', () => {
  const p = newProject();
  DB.setSetting('budget', { perVideoUsd: 1 });
  resetSpendCache();
  spend(p.id, 2);
  const state = spendState({ projectId: p.id, channelId: ch.id });
  assert.deepEqual(state.over, ['video_usd']);
  assert.equal(state.hardStop, false);
  assert.doesNotThrow(() => assertSpendAllowed({ projectId: p.id, channelId: ch.id }), 'no hardStop, no refusal');
});

test('hardStop refuses at the two places money is spent, and is not retryable', () => {
  const p = newProject();
  DB.setSetting('budget', { perVideoUsd: 1, hardStop: true });
  resetSpendCache();
  spend(p.id, 1.5);
  let err;
  try { assertSpendAllowed({ projectId: p.id, channelId: ch.id }); } catch (e) { err = e; }
  assert.ok(err, 'the guard refused');
  assert.equal(err.appCode, 'budget.exceeded');
  assert.equal(classifyError(err).retryable, false, 'an auto-resume cannot make money appear');
  assert.doesNotThrow(() => assertSpendAllowed({}), 'outside a run there is nothing to cap');
});

test('a daily channel cap counts spend and finished videos since local midnight', () => {
  // Its own channel: the tests above already spent against the shared one today.
  const day = DB.createChannel({ name: 'Daily' });
  const project = () => DB.createProject({ title: 'd', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {}, channelId: day.id });
  DB.setSetting('budget', { perChannelDayUsd: 10, perChannelDayVideos: 2, hardStop: true });
  resetSpendCache();
  const a = project();
  DB.recordUsageRow({ projectId: a.id, channelId: day.id, kind: 'llm', estCost: 4 });
  assert.deepEqual(spendState({ channelId: day.id }).over, [], 'under both caps');
  DB.recordUsageRow({ projectId: a.id, channelId: day.id, kind: 'llm', estCost: 7 });
  assert.deepEqual(spendState({ channelId: day.id }).over, ['channel_day_usd']);

  DB.setSetting('budget', { perChannelDayVideos: 2, hardStop: true });
  resetSpendCache();
  for (const p of [project(), project()]) DB.updateProject(p.id, { status: 'done' });
  assert.deepEqual(spendState({ channelId: day.id }).over, ['channel_day_videos']);
});

test('the route refuses before it queues anything, with the code an agent reads', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const p = newProject();
    DB.setSetting('budget', { perVideoUsd: 1, hardStop: true });
    resetSpendCache();
    spend(p.id, 3);
    const r = await fetch(`${base}/projects/${p.id}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 402);
    assert.equal((await r.json()).code, 'budget_exceeded');
    assert.deepEqual(DB.listJobs({ projectId: p.id }), [], 'nothing was queued');
  } finally {
    server.close();
    DB.setSetting('budget', {});
    resetSpendCache();
  }
});
