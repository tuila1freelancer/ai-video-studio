import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { isLocalRequest, resetUiSession, uiSessionToken, wantsUiSession } from '../src/ops/ui-session.js';
import { mountStaticSite } from '../src/api/static-site.js';
import { PATHS } from '../src/config/paths.js';

const withKey = (key) => ({ AVS_UI_KEY: key });

test('a nonce is only honoured when one was issued, matches, and comes from this machine', () => {
  const local = { ip: '127.0.0.1' };
  assert.equal(wantsUiSession({ ...local, query: { uikey: 'abc' } }, {}), false, 'no nonce issued, nothing to trade');
  assert.equal(wantsUiSession({ ...local, query: { uikey: 'abc' } }, withKey('abc')), true);
  assert.equal(wantsUiSession({ ...local, query: { uikey: 'abd' } }, withKey('abc')), false);
  assert.equal(wantsUiSession({ ...local, query: { uikey: 'ab' } }, withKey('abc')), false, 'a prefix is not the nonce');
  assert.equal(wantsUiSession({ ...local, query: {} }, withKey('abc')), false);
  assert.equal(wantsUiSession({ ip: '192.168.1.40', query: { uikey: 'abc' } }, withKey('abc')), false,
    'the nonce is worthless from anywhere but this machine');
  assert.equal(isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '10.0.0.2' } }), false);
});

test('the window session is one token, kept for the life of the process and never offered for revoking', () => {
  resetUiSession();
  const first = uiSessionToken();
  assert.match(first, /^avs_sys[a-z0-9]+_/, 'a system id, not a token a person made');
  assert.equal(uiSessionToken(), first, 'a reload gets the same session, not a new row each time');
  assert.ok(DB.verifyApiToken(first), 'and it authenticates');
  assert.ok(!DB.listApiTokens({ includeSystem: false }).some((t) => first.includes(t.id)),
    'the revoke list a person sees does not include the window');
  assert.ok(DB.listApiTokens().some((t) => first.includes(t.id)), 'but it exists');
});

test('the window trades its nonce for a cookie, once, and lands on a clean URL', async () => {
  process.env.AVS_UI_KEY = 'nonce-for-this-boot';
  resetUiSession();
  const app = express();
  mountStaticSite(app, PATHS.publicDir);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const traded = await fetch(`${base}/?uikey=nonce-for-this-boot`, { redirect: 'manual' });
    assert.equal(traded.status, 302);
    assert.equal(traded.headers.get('location'), '/');
    const cookie = traded.headers.get('set-cookie') || '';
    assert.match(cookie, /^avs_token=avs_sys/);
    assert.match(cookie, /HttpOnly/i, 'no page script needs to read it');
    assert.match(cookie, /SameSite=Strict/i);

    const plain = await fetch(`${base}/`);
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('set-cookie'), null, 'the document alone hands out nothing');

    const wrong = await fetch(`${base}/?uikey=not-the-nonce`, { redirect: 'manual' });
    assert.equal(wrong.status, 200);
    assert.equal(wrong.headers.get('set-cookie'), null);
  } finally {
    server.close();
    delete process.env.AVS_UI_KEY;
    resetUiSession();
  }
});
