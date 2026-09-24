import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

const ch = DB.createChannel({ name: 'Events' });
const project = DB.createProject({ title: 'e', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {}, channelId: ch.id });
const other = DB.createProject({ title: 'o', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
const write = (projectId, kind, msg, level = 'info') => DB.insertJournal({
  project_id: projectId, job_id: null, ts: Date.now(), level, stage: null, scene_idx: null, kind, msg, data: null, actor: 'token:t1',
});

test('the cursor reads forwards and never repeats what was already seen', () => {
  const start = DB.journalHeadId();
  write(project.id, 'status', 'bắt đầu');
  write(project.id, 'op', 'đang dựng cảnh');
  const first = DB.journalAfter({ afterId: start });
  assert.equal(first.events.length, 2);
  assert.equal(first.events[0].msg, 'bắt đầu', 'oldest first — an agent replays in order');
  const second = DB.journalAfter({ afterId: first.events[1].id });
  assert.deepEqual(second.events, [], 'nothing new yet');
  write(project.id, 'done', 'xong');
  const third = DB.journalAfter({ afterId: first.events[1].id });
  assert.deepEqual(third.events.map((e) => e.msg), ['xong']);
});

test('filters: project, channel, kind, level — and a page says there is more', () => {
  const start = DB.journalHeadId();
  write(project.id, 'error', 'hỏng rồi', 'error');
  write(other.id, 'status', 'dự án khác');
  assert.deepEqual(DB.journalAfter({ afterId: start, projectId: project.id }).events.map((e) => e.msg), ['hỏng rồi']);
  assert.deepEqual(DB.journalAfter({ afterId: start, channelId: ch.id }).events.map((e) => e.msg), ['hỏng rồi']);
  assert.deepEqual(DB.journalAfter({ afterId: start, kinds: ['status'] }).events.map((e) => e.msg), ['dự án khác']);
  assert.deepEqual(DB.journalAfter({ afterId: start, level: 'warn' }).events.map((e) => e.msg), ['hỏng rồi'], 'warn means warn and worse');
  const page = DB.journalAfter({ afterId: start, limit: 1 });
  assert.equal(page.events.length, 1);
  assert.equal(page.hasMore, true);
});

test('over HTTP: no cursor means "from now", a cursor means "what I missed"', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const head = await (await fetch(`${base}/events`)).json();
    assert.deepEqual(head.events, [], 'a first call subscribes, it does not replay every run ever made');
    assert.ok(head.lastId > 0);
    write(project.id, 'status', 'sau khi đăng ký');
    const next = await (await fetch(`${base}/events?after=${head.lastId}`)).json();
    assert.deepEqual(next.events.map((e) => e.msg), ['sau khi đăng ký']);
    assert.equal(next.events[0].actor, 'token:t1', 'the feed says who asked');
    assert.equal(next.events[0].channelId, ch.id);
    assert.equal(next.lastId, next.events[0].id);

    // A long poll returns as soon as something happens, rather than on a timer.
    const started = Date.now();
    const waiting = fetch(`${base}/events?after=${next.lastId}&wait=5`).then((r) => r.json());
    setTimeout(() => write(project.id, 'done', 'tới trong lúc chờ'), 300);
    const late = await waiting;
    assert.deepEqual(late.events.map((e) => e.msg), ['tới trong lúc chờ']);
    assert.ok(Date.now() - started < 4500, 'it answered on the event, not on the timeout');
  } finally { server.close(); }
});
