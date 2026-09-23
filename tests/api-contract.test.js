import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { codeFor, apiError } from '../src/core/api-codes.js';
import { requestLang } from '../src/api/request-lang.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

test('every refusal has a code: named where it matters, by status otherwise', () => {
  assert.equal(codeFor('not found', 404), 'not_found');
  assert.equal(codeFor('forbidden', 403), 'forbidden');
  assert.equal(codeFor('dự án không ở bước duyệt cảnh', 409), 'gate_not_at_scenes');
  assert.equal(codeFor('video chưa render xong', 400), 'video_not_ready');
  assert.equal(codeFor('một câu chưa ai đặt tên', 409), 'conflict', 'an unnamed message still gets a code');
  assert.equal(codeFor('anything', 500), 'internal');
  assert.equal(codeFor('anything', 418), 'request_failed');
  const e = apiError('budget_exceeded', 'hết ngân sách', 402);
  assert.equal(e.code, 'budget_exceeded');
  assert.equal(e.status, 402);
  assert.equal(e.expose, true);
});

test('the reply language is per request, and only when asked for', () => {
  assert.equal(requestLang({ query: { lang: 'en' } }), 'en');
  assert.equal(requestLang({ query: { lang: 'EN' } }), 'en');
  assert.equal(requestLang({ query: { lang: 'klingon' } }), null);
  assert.equal(requestLang({ headers: { 'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8' } }), 'ja');
  assert.equal(requestLang({ headers: { 'accept-language': 'xx' } }), null);
  assert.equal(requestLang({}), null, 'no ask means the interface language');
});

test('a live route carries the code, and answers in the language asked for', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
  try {
    const missing = await get('/projects/nope-there-is-no-such-project');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'not_found', 'the agent branches on this, never on the sentence');
    assert.equal(missing.body.error, 'không tìm thấy', 'the owner still reads Vietnamese');
    const english = await get('/projects/nope-there-is-no-such-project?lang=en');
    assert.equal(english.body.code, 'not_found');
    assert.equal(english.body.error, 'Not found');
    const ok = await get('/health');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.code, undefined, 'a success carries no code');
  } finally { server.close(); }
});
