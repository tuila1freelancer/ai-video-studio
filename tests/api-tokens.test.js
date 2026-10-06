import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiToken, listApiTokens, revokeApiToken, verifyApiToken, tokenHasChannel, tokenHasScope, countApiTokens } from '../src/db/index.js';

test('a minted token verifies once, and only in its exact form', () => {
  const made = createApiToken({ name: 'agent-a', scopes: ['read', 'produce'] });
  assert.match(made.token, /^avs_tok[a-z0-9]+_[A-Za-z0-9_-]{32}$/);
  const seen = verifyApiToken(made.token);
  assert.equal(seen.id, made.id);
  assert.deepEqual(seen.scopes, ['read', 'produce']);
  assert.equal(verifyApiToken(`${made.token}x`), null, 'a mutated secret is not the token');
  assert.equal(verifyApiToken(`avs_${made.id}_wrongsecretwrongsecretwrong`), null);
  assert.equal(verifyApiToken('garbage'), null);
  assert.equal(verifyApiToken(''), null);
  assert.equal(verifyApiToken(null), null);
});

test('the secret is never stored, and a revoked token stays auditable', () => {
  const made = createApiToken({ name: 'agent-b', scopes: ['read'] });
  const secret = made.token.split('_').slice(2).join('_'); // base64url may itself contain '_'
  const stored = JSON.stringify(listApiTokens());
  assert.ok(!stored.includes(secret), 'the database must not carry the secret');
  assert.equal(revokeApiToken(made.id), 1);
  assert.equal(verifyApiToken(made.token), null, 'a revoked token stops working');
  assert.equal(revokeApiToken(made.id), 0, 'revoking twice is not an event');
  assert.ok(listApiTokens({ includeRevoked: true }).some((t) => t.id === made.id));
  assert.ok(!listApiTokens().some((t) => t.id === made.id));
});

test('scopes and channels are checked, admin implies the rest', () => {
  const produce = createApiToken({ name: 'p', scopes: ['produce'], channelIds: ['ch1'] });
  assert.equal(tokenHasScope(produce, 'produce'), true);
  assert.equal(tokenHasScope(produce, 'publish'), false);
  assert.equal(tokenHasChannel(produce, 'ch1'), true);
  assert.equal(tokenHasChannel(produce, 'ch2'), false);
  const admin = createApiToken({ name: 'a', scopes: ['admin'] });
  assert.equal(tokenHasScope(admin, 'publish'), true, 'admin covers every scope');
  assert.equal(tokenHasChannel(admin, 'ch2'), true, 'no channel list means every channel');
  assert.ok(countApiTokens() >= 2);
  assert.throws(() => createApiToken({ scopes: ['root'] }), /read\|produce\|publish\|admin/);
});
