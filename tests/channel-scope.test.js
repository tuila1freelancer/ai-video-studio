import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { channelFor, askedChannelId } from '../src/api/channel-scope.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

const chA = DB.createChannel({ name: 'Alpha' });
const chB = DB.createChannel({ name: 'Beta' });

test('the caller may name its channel in body, query or header', () => {
  assert.equal(askedChannelId({ body: { channelId: chA.id } }), chA.id);
  assert.equal(askedChannelId({ query: { channel: chB.id } }), chB.id);
  assert.equal(askedChannelId({ headers: { 'x-avs-channel': chA.id } }), chA.id);
  assert.equal(askedChannelId({}), null);
});

test('a named channel wins over the active one, and an unknown one is refused', () => {
  DB.setActiveChannel(chA.id);
  assert.equal(channelFor({ body: { channelId: chB.id } }).id, chB.id);
  assert.equal(channelFor({}).id, chA.id, 'no ask falls back to the active channel');
  assert.throws(() => channelFor({ body: { channelId: 'no-such-channel' } }), /kênh không tồn tại/);
});

test('a token bound to a channel cannot reach another, named or defaulted', () => {
  DB.setActiveChannel(chA.id);
  const token = { id: 'tok1', scopes: ['produce'], channelIds: [chB.id] };
  assert.equal(channelFor({ token }).id, chB.id, 'its own channel, not the window’s');
  assert.throws(() => channelFor({ token, body: { channelId: chA.id } }), /không được phép/);
});

test('two callers creating at once land in the channel each one named', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }).then((r) => r.json());
  try {
    DB.setActiveChannel(chA.id);
    const [a, b] = await Promise.all([
      post('/projects', { topic: 'alpha side of the world', channelId: chA.id }),
      post('/projects', { topic: 'beta side of the world', channelId: chB.id }),
    ]);
    assert.equal(a.project.channel_id, chA.id);
    assert.equal(b.project.channel_id, chB.id, 'the other agent did not drag it into the active channel');
    const list = await fetch(`${base}/projects?channel=${chB.id}`).then((r) => r.json());
    assert.deepEqual(list.projects.map((p) => p.id), [b.project.id]);
  } finally { server.close(); }
});
