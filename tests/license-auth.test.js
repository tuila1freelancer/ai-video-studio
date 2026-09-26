// The sign-in layer's pure parts: the link URL, PKCE, licence choice, storage.
// The loopback/browser round-trip is exercised end-to-end against a real
// store in development; unit tests stay off the network.
import './_env.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buyUrl, chooseLicense } from '../src/license/auth.js';
import { clientKeyPrefix, desktopLinkUrl, pkcePair } from '../src/license/sdk.js';
import { clearSession, readSession, writeSession } from '../src/license/store.js';

const lic = (over = {}) => ({
  id: 'l1',
  key: 'TOOLS-AAAA-BBBB-CCCC-DDDD',
  status: 'active',
  expiresAt: null,
  ...over,
});

test('chooseLicense ranks what the store already narrowed to this product', () => {
  // No product field arrives any more: the client key decided that at the store.
  const only = lic();
  assert.equal(chooseLicense([only]), only);
});

test('chooseLicense prefers active, and never offers one the store would refuse', () => {
  const revoked = lic({ id: 'r', status: 'revoked' });
  const active = lic({ id: 'a', status: 'active' });
  assert.equal(chooseLicense([revoked, active]).id, 'a');
  // Alone, a revoked or suspended licence is no licence: activating it would fail and the sign-in
  // would read as an error instead of "this account owns nothing here".
  assert.equal(chooseLicense([revoked]), null);
  assert.equal(chooseLicense([lic({ status: 'suspended' })]), null);
  // Expired is different: the store still activates it and the token carries the grace window.
  assert.equal(chooseLicense([lic({ id: 'e', status: 'expired' })]).id, 'e');
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

test('only the public half of the client key is ever put in a URL', () => {
  const key = 'pk_0123abcd.0000111122223333444455556666777788889999aaaa';
  assert.equal(clientKeyPrefix(key), 'pk_0123abcd');
  const url = new URL(
    desktopLinkUrl('https://store.example', {
      client: clientKeyPrefix(key),
      state: 'a'.repeat(24),
      challenge: 'b'.repeat(43),
      port: 51234,
      label: 'MacBook',
      platform: 'macos-arm64',
    }),
  );
  assert.equal(url.pathname, '/link/desktop');
  assert.equal(url.searchParams.get('client'), 'pk_0123abcd');
  assert.equal(url.searchParams.get('port'), '51234');
  assert.equal(url.searchParams.get('label'), 'MacBook');
  assert.ok(!url.search.includes('0000111122223333'), 'the secret must never reach the browser');
});

test('the PKCE challenge is the S256 digest the store will recompute', () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(challenge.length, 43);
  assert.notEqual(pkcePair().verifier, verifier);
});

test('the buy link points at the product page that exists', () => {
  process.env.TOOLS_PLATFORM_WEB_URL = 'https://www.tuila1freelancer.com';
  assert.equal(buyUrl(), 'https://www.tuila1freelancer.com/store/products/ai-video-studio');
  delete process.env.TOOLS_PLATFORM_WEB_URL;
});

test('session store round-trips and clears', () => {
  clearSession();
  assert.deepEqual(readSession(), {});
  writeSession({ user: { email: 'a@b.c', name: null }, token: 'link-token' });
  assert.equal(readSession().user.email, 'a@b.c');
  assert.equal(readSession().token, 'link-token');
  clearSession();
  assert.deepEqual(readSession(), {});
});
