import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { acceptingWork, opsState, setOpsState } from '../src/ops/state.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

test('the valve defaults open and remembers being closed', () => {
  assert.equal(opsState().state, 'running');
  assert.equal(acceptingWork(), true);
  setOpsState('paused', { by: 'token:t1', reason: 'deploy' });
  assert.equal(acceptingWork(), false);
  const s = opsState();
  assert.equal(s.state, 'paused');
  assert.equal(s.by, 'token:t1');
  assert.equal(s.reason, 'deploy');
  assert.ok(s.at > 0);
  assert.equal(acceptingWork(), false, 'draining is not accepting either');
  setOpsState('draining');
  assert.equal(acceptingWork(), false);
  setOpsState('running');
  assert.equal(acceptingWork(), true);
  assert.throws(() => setOpsState('sleepy'), /unknown ops state/);
});

test('the scheduler holds while paused, and is told to pick up again on resume', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const paused = await post('/ops/pause', { reason: 'nâng cấp' });
    assert.equal(paused.ops.state, 'paused');
    assert.equal(paused.ops.reason, 'nâng cấp');

    const project = DB.createProject({ title: 'held', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
    const { submit, tick, runningCount } = await import('../src/pipeline/scheduler.js');
    submit({ kind: 'pipeline', projectId: project.id, payload: {} });
    tick();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(runningCount(), 0, 'a queued job stays queued while the valve is shut');
    assert.equal(DB.listJobs({ projectId: project.id })[0].status, 'queued');

    // Nothing is running, so a drain is honest about it straight away.
    const drained = await post('/ops/drain');
    assert.equal(drained.ops.state, 'paused');
    assert.equal(drained.jobs.queued, 1);

    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ops, 'paused', 'a monitor sees it without a second call');

    const resumed = await post('/ops/resume');
    assert.equal(resumed.ops.state, 'running');
    DB.cancelJob(DB.listJobs({ projectId: project.id })[0].id);
    setOpsState('paused'); // leave the queue shut: this suite must not start real renders
  } finally { server.close(); }
});
