import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';
import { AvsClient, AvsError } from '../packages/avs-kit/src/sdk.js';
import { isTemporary } from '../packages/avs-kit/src/errors.js';

async function engine() {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('a refusal becomes a decision, not a string to parse', () => {
  const denied = new AvsError('nope', { code: 'scope_denied', status: 403 });
  assert.equal(denied.retryable, false);
  assert.equal(denied.exitCode, 3);
  const limited = new AvsError('slow down', { code: 'rate_limited', status: 429 });
  assert.equal(limited.retryable, true);
  assert.equal(limited.exitCode, 4);
  assert.equal(isTemporary(limited), true);
  const broke = new AvsError('no', { code: 'budget_exceeded', status: 402 });
  assert.equal(broke.exitCode, 5);
  assert.equal(isTemporary(broke), true, 'a cap is "not now", not "not like this"');
  assert.equal(new AvsError('x', { code: 'verdict_failed', status: 409 }).exitCode, 2);
});

test('the kit drives the engine end to end, on the control plane', async () => {
  const { server, url } = await engine();
  const ch = DB.createChannel({ name: 'Kit' });
  const avs = new AvsClient({ url, channel: ch.id });
  try {
    const health = await avs.health();
    assert.equal(health.ok, true);
    assert.equal(health.mode, 'desktop');

    const { channels } = await avs.channels();
    assert.ok(channels.some((c) => c.id === ch.id));

    // Create twice under one reference: the second call must not make a second video.
    const first = await avs.createProject({ topic: 'the kit creates exactly one video', clientRef: 'kit-run-1' });
    const again = await avs.createProject({ topic: 'the kit creates exactly one video', clientRef: 'kit-run-1' });
    assert.equal(again.project.id, first.project.id);
    assert.equal(first.project.channel_id, ch.id, 'the channel came from the client, not the window');

    const { projects } = await avs.projects({ channel: ch.id });
    assert.deepEqual(projects.map((p) => p.id), [first.project.id]);

    const verdict = await avs.verdict(first.project.id);
    assert.equal(verdict.publishable, false, 'nothing has been rendered yet');
    assert.ok(verdict.reasons.some((r) => r.code === 'project.not_done'));

    const ops = await avs.pause('kit test');
    assert.equal(ops.ops.state, 'paused');
    assert.equal((await avs.ops()).ops.reason, 'kit test');
    await avs.resume();

    // The feed: subscribe, make something happen, read it back from the cursor.
    const head = await avs.events({});
    DB.insertJournal({ project_id: first.project.id, job_id: null, ts: Date.now(), level: 'info', stage: null, scene_idx: null, kind: 'status', msg: 'agent đang xem', data: null, actor: 'token:kit' });
    const feed = await avs.events({ after: head.lastId, project: first.project.id });
    assert.deepEqual(feed.events.map((e) => e.msg), ['agent đang xem']);

    let missing;
    try { await avs.project('no-such-project'); } catch (e) { missing = e; }
    assert.equal(missing.code, 'not_found');
    assert.equal(missing.exitCode, 3);
  } finally {
    server.close();
    await DB.setSetting('ops', { state: 'running' });
  }
});

test('waitFor returns the moment a project reaches a state it was told to wait for', async () => {
  const { server, url } = await engine();
  const avs = new AvsClient({ url });
  try {
    const p = DB.createProject({ title: 'w', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
    setTimeout(() => DB.updateProject(p.id, { status: 'done' }), 150);
    const settled = await avs.waitFor(p.id, { states: ['done'], timeoutMs: 8000, pollMs: 100 });
    assert.equal(settled.status, 'done');

    DB.updateProject(p.id, { status: 'running' });
    let timedOut;
    try { await avs.waitFor(p.id, { states: ['done'], timeoutMs: 300, pollMs: 100 }); } catch (e) { timedOut = e; }
    assert.equal(timedOut.code, 'wait_timeout');
  } finally { server.close(); }
});
