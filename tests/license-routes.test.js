// Activation, refresh and update against a fake store.
//
// A real store is not needed to prove the parts that matter: that a refusal becomes a sentence a
// customer can act on, that the licence file ends up in the right shape, and — the one that would
// otherwise cost a support ticket per customer per outage — that being offline is never treated as
// being unlicensed.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { activate, invalidate, publicStatus, refreshNow, setAppVersion, status } from '../src/license/index.js';
import { clearStore, readStore, writeStore } from '../src/license/store.js';
import { checkUpdate, isNewer, resetUpdateCache } from '../src/license/update.js';
import { deviceId } from '../src/license/device.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const KEY = 'TOOLS-1111-2222-3333-4444';
const realFetch = globalThis.fetch;

function token(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    licenseKey: KEY, productSlug: 'ai-video-studio', plan: 'Pro Monthly', features: [],
    deviceId: deviceId(), expiresAt: null, graceUntil: null, iat: now, exp: now + 2_592_000, ...claims,
  });
  const s = createSign('RSA-SHA256');
  s.update(`${header}.${payload}`);
  s.end();
  return `${header}.${payload}.${s.sign(privateKey, 'base64url')}`;
}

/** Answer every store call from a table; anything unlisted is a 404. */
function mockStore(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0];
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    const handler = routes[path];
    if (!handler) return new Response('{"message":"not found"}', { status: 404 });
    const result = typeof handler === 'function' ? await handler() : handler;
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body ?? result), { status: result.status ?? 200 });
  };
  return calls;
}

function withStore(t) {
  process.env.TOOLS_PLATFORM_URL = 'https://store.test';
  process.env.TOOLS_STORE_CLIENT_KEY = 'pk_test.secret';
  process.env.TOOLS_STORE_PUBLIC_KEY = PEM;
  delete process.env.TOOLS_LICENSE_BYPASS;
  setAppVersion('1.0.0');
  clearStore();
  invalidate();
  resetUpdateCache();
  t.after(() => {
    globalThis.fetch = realFetch;
    delete process.env.TOOLS_PLATFORM_URL;
    delete process.env.TOOLS_STORE_CLIENT_KEY;
    delete process.env.TOOLS_STORE_PUBLIC_KEY;
    clearStore();
    invalidate();
    resetUpdateCache();
  });
}

test('activation stores the token and unlocks the app', async (t) => {
  withStore(t);
  const calls = mockStore({ '/licenses/activate': { body: { token: token(), expiresAt: null, graceUntil: null, features: [] } } });

  const result = await activate('tools-1111-2222-3333-4444');
  assert.equal(result.state, 'valid');
  assert.equal(calls[0].body.licenseKey, KEY, 'the key is normalised to upper case before it is sent');
  assert.equal(calls[0].body.deviceId, deviceId());

  const file = readStore();
  assert.equal(file.key, KEY);
  assert.ok(file.token && file.activatedAt && file.lastValidatedAt);

  const shown = publicStatus();
  assert.equal(shown.key, 'TOOLS-••••-••••-••••-4444', 'the UI never gets the whole key');
  assert.equal(shown.plan, 'Pro Monthly');
  assert.equal(shown.runnable, true);
});

test('a full device list points the customer at the page that fixes it', async (t) => {
  withStore(t);
  mockStore({ '/licenses/activate': { status: 403, body: { message: 'Device limit reached for this license' } } });
  await assert.rejects(activate(KEY), (e) => {
    assert.equal(e.statusCode, 403);
    // "No" is not an answer a customer can act on; the link is.
    assert.match(e.message, /Hết slot thiết bị/);
    assert.match(e.message, /https:\/\/store\.test\/dashboard\/devices/);
    return true;
  });
  assert.deepEqual(readStore(), {}, 'and nothing is written for a licence that was refused');
});

test('a mistyped key says so instead of blaming the network', async (t) => {
  withStore(t);
  mockStore({});
  await assert.rejects(activate(KEY), (e) => {
    assert.equal(e.statusCode, 404);
    assert.match(e.message, /Không tìm thấy license key TOOLS-••••/);
    return true;
  });
});

test('being offline is not being unlicensed', async (t) => {
  withStore(t);
  mockStore({ '/licenses/activate': { body: { token: token(), expiresAt: null, graceUntil: null, features: [] } } });
  await activate(KEY);
  assert.equal(status({ fresh: true }).state, 'valid');

  // Now the store disappears — a plane, a hotel wifi, a store outage.
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const after = await refreshNow();
  assert.equal(after.state, 'valid', 'the app keeps working on the token it already holds');
  assert.ok(readStore().token, 'and does not throw its licence away over a network error');
});

test('a revoked licence locks the app on the next heartbeat', async (t) => {
  withStore(t);
  mockStore({ '/licenses/activate': { body: { token: token(), expiresAt: null, graceUntil: null, features: [] } } });
  await activate(KEY);

  mockStore({ '/licenses/validate': { body: { valid: false, status: 'revoked', expiresAt: null, graceUntil: null, deviceRegistered: true } } });
  const after = await refreshNow();
  assert.equal(after.state, 'locked');
  assert.equal(after.reason, 'revoked');
  assert.equal(readStore().token, null, 'the token is dropped, the key is kept for a re-check');
  assert.equal(readStore().key, KEY);
});

test('a licence deleted at the store is treated as revoked, not as a network blip', async (t) => {
  withStore(t);
  mockStore({ '/licenses/activate': { body: { token: token(), expiresAt: null, graceUntil: null, features: [] } } });
  await activate(KEY);
  mockStore({}); // validate now 404s
  const after = await refreshNow();
  assert.equal(after.state, 'locked');
  assert.equal(after.reason, 'revoked');
});

test('a token close to expiry is renewed before it becomes a problem', async (t) => {
  withStore(t);
  // Two days of life left: the refresh must fetch a new one rather than wait for the app to break.
  const shortLived = token({ exp: Math.floor(Date.now() / 1000) + 2 * 86_400 });
  writeStore({ key: KEY, token: shortLived, status: 'active', lastValidatedAt: new Date().toISOString() });
  invalidate();

  const calls = mockStore({
    '/licenses/validate': { body: { valid: true, status: 'active', expiresAt: null, graceUntil: null, deviceRegistered: true } },
    '/licenses/activate': { body: { token: token(), expiresAt: null, graceUntil: null, features: [] } },
  });
  await refreshNow();
  assert.deepEqual(calls.map((c) => c.path), ['/licenses/validate', '/licenses/activate']);
  assert.notEqual(readStore().token, shortLived, 'a fresh token replaced the expiring one');
});

test('the update check compares versions and only shouts when there is something newer', async (t) => {
  withStore(t);
  setAppVersion('1.0.0');
  mockStore({ '/versions/latest': { body: { id: 'v2', version: '1.0.10', changelog: 'Sửa lỗi ghép video', fileSize: 123, checksum: 'abc' } } });
  const info = await checkUpdate({ force: true });
  assert.equal(info.hasUpdate, true);
  assert.equal(info.latest, '1.0.10');
  assert.equal(info.current, '1.0.0');

  resetUpdateCache();
  setAppVersion('1.0.10');
  assert.equal((await checkUpdate({ force: true })).hasUpdate, false);
  assert.equal(isNewer('1.0.10', '1.0.9'), true, 'and the comparison is numeric, not alphabetical');
});

test('a store that cannot be reached does not become a cached "no update"', async (t) => {
  withStore(t);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await checkUpdate({ force: true })).hasUpdate, false);
  // The failure must not be cached, or one flaky check hides a release for six hours.
  mockStore({ '/versions/latest': { body: { id: 'v2', version: '9.0.0' } } });
  assert.equal((await checkUpdate()).hasUpdate, true);
});
