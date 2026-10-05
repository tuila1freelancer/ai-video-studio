import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requiredScope } from '../src/api/scopes.js';
import { apiAuth, authRefusal, bearerOf } from '../src/api/middleware/auth.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';
import { createApiToken } from '../src/db/index.js';

const serverMode = (on) => { if (on) process.env.AVS_MODE = 'server'; else delete process.env.AVS_MODE; };

test('the scope map is ordered and fails closed', () => {
  assert.equal(requiredScope('GET', '/health'), null);
  assert.equal(requiredScope('GET', '/projects'), 'read');
  assert.equal(requiredScope('GET', '/settings'), 'read', 'reads are reads — secrets are masked anyway');
  assert.equal(requiredScope('POST', '/projects'), 'produce');
  assert.equal(requiredScope('POST', '/projects/p1/start'), 'produce');
  assert.equal(requiredScope('POST', '/projects/p1/publish'), 'publish');
  assert.equal(requiredScope('GET', '/publish/status'), 'read');
  assert.equal(requiredScope('POST', '/publish/pages/1/select'), 'publish');
  assert.equal(requiredScope('POST', '/publish/youtube/auth-url'), 'admin', 'connecting is not publishing');
  assert.equal(requiredScope('PUT', '/settings'), 'admin');
  assert.equal(requiredScope('POST', '/settings'), 'admin');
  assert.equal(requiredScope('DELETE', '/channels/c1'), 'admin');
  assert.equal(requiredScope('POST', '/ops/pause'), 'admin');
  assert.equal(requiredScope('POST', '/some-route-invented-tomorrow'), 'produce');
});

test('bearer parsing accepts only the header form it documents', () => {
  assert.equal(bearerOf({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(bearerOf({ headers: { authorization: 'bearer abc' } }), 'abc');
  assert.equal(bearerOf({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(bearerOf({ headers: {} }), null);
  assert.equal(bearerOf({}), null);
});

test('desktop mode is untouched: no token, and the caller is the ui', () => {
  serverMode(false);
  let passed = false;
  const req = { method: 'POST', path: '/projects', headers: {} };
  apiAuth(req, {}, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.actor, 'ui');
  assert.equal(authRefusal(), null);
});

test('server mode refuses to start with nobody to answer to', () => {
  serverMode(true);
  assert.match(authRefusal() || '', /npm run token/, 'the refusal says how to fix it');
  createApiToken({ name: 'boot', scopes: ['read'] });
  assert.equal(authRefusal(), null, 'one live token is enough to open the door');
  serverMode(false);
});

test('server mode: no token 401, wrong scope 403, right scope through', async () => {
  serverMode(true);
  const readOnly = createApiToken({ name: 'reader', scopes: ['read'] });
  const producer = createApiToken({ name: 'maker', scopes: ['read', 'produce'] });
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, { token, method = 'GET', body } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await call('/health')).status, 200, '/health stays open — the launcher polls it');
    const anon = await call('/projects');
    assert.equal(anon.status, 401);
    assert.equal(anon.body.code, 'token_required');
    assert.equal((await call('/projects', { token: 'avs_tokwrong_wrongwrongwrongwrongwrong' })).status, 401);
    assert.equal((await call('/projects', { token: readOnly.token })).status, 200);
    const denied = await call('/projects', { token: readOnly.token, method: 'POST', body: { topic: 'x' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'scope_denied');
    const made = await call('/projects', { token: producer.token, method: 'POST', body: { topic: 'a token that may produce' } });
    assert.equal(made.status, 200);
    assert.ok(made.body.project?.id);
  } finally {
    server.close();
    serverMode(false);
  }
});

test('the journal records who asked, not only what happened', async () => {
  const { default: DB } = await import('../src/db/index.js');
  const { jlog } = await import('../src/pipeline/journal.js');
  const { withRunContext } = await import('../src/util/run-context.js');
  const p = (await import('../src/db/index.js')).createProject({ title: 'actor', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
  withRunContext({ projectId: p.id, actor: 'token:tok42' }, () => jlog(p.id, { kind: 'status', msg: 'một việc do agent yêu cầu' }));
  jlog(p.id, { kind: 'status', msg: 'một việc không có ai đứng tên' });
  const rows = (await import('../src/db/index.js')).listJournal({ projectId: p.id });
  assert.equal(rows.find((r) => r.msg.includes('agent')).actor, 'token:tok42');
  assert.equal(rows.find((r) => r.msg.includes('không có ai')).actor, null);
  assert.ok(DB);
});

test('a browser subresource authenticates by cookie, since it cannot carry a header', () => {
  assert.equal(bearerOf({ headers: { cookie: 'x=1; avs_token=avs_tok1_secret; y=2' } }), 'avs_tok1_secret');
  assert.equal(bearerOf({ headers: { cookie: 'avs_token=avs%5Ftok1' } }), 'avs_tok1', 'url-encoded values decode');
  assert.equal(bearerOf({ headers: { authorization: 'Bearer from-header', cookie: 'avs_token=from-cookie' } }), 'from-header',
    'an explicit header still wins');
  assert.equal(bearerOf({ headers: { cookie: 'other=1' } }), null);
});
