// The sign-in layer's pure parts: licence choice and session persistence.
// The loopback/browser round-trip is exercised end-to-end against a real
// store in development; unit tests stay off the network.
import './_env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseLicense } from '../src/license/auth.js';
import { clearSession, readSession, writeSession } from '../src/license/store.js';

const lic = (over = {}) => ({
  id: 'l1',
  key: 'TOOLS-AAAA-BBBB-CCCC-DDDD',
  status: 'active',
  expiresAt: null,
  product: { slug: 'ai-video-generation', name: 'AI Video Generation' },
  ...over,
});

test('chooseLicense only ever picks this product', () => {
  const other = lic({ product: { slug: 'reup-video', name: 'Reup' }, key: 'TOOLS-X' });
  assert.equal(chooseLicense([other]), null);
  const mine = lic();
  assert.equal(chooseLicense([other, mine]), mine);
});

test('chooseLicense prefers active over anything else', () => {
  const revoked = lic({ id: 'r', status: 'revoked' });
  const active = lic({ id: 'a', status: 'active' });
  assert.equal(chooseLicense([revoked, active]).id, 'a');
});

test('chooseLicense prefers the licence expiring last; lifetime beats all', () => {
  const soon = lic({ id: 'soon', expiresAt: '2026-09-01T00:00:00Z' });
  const later = lic({ id: 'later', expiresAt: '2027-09-01T00:00:00Z' });
  const lifetime = lic({ id: 'life', expiresAt: null });
  assert.equal(chooseLicense([soon, later]).id, 'later');
  assert.equal(chooseLicense([soon, lifetime, later]).id, 'life');
});

test('chooseLicense survives junk input', () => {
  assert.equal(chooseLicense(null), null);
  assert.equal(chooseLicense([]), null);
  assert.equal(chooseLicense([{}, { product: {} }, lic({ key: null })]), null);
});

test('session store round-trips and clears', () => {
  clearSession();
  assert.deepEqual(readSession(), {});
  writeSession({ user: { email: 'a@b.c', name: null }, accessToken: 't', refreshToken: 'r' });
  assert.equal(readSession().user.email, 'a@b.c');
  clearSession();
  assert.deepEqual(readSession(), {});
});
