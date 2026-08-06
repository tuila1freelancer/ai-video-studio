// Whether this copy of the app may run — every branch of it, with no network and no store.
//
// The state machine is the only thing standing between a paying customer and a locked app, so it
// is tested against real RS256 tokens signed by a keypair minted here: a test that stubs the
// signature check proves nothing about the one property that matters.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { licenseState, isRunnable, reasonText } from '../src/license/state.js';
import { isWithinGrace, verifyLicenseToken } from '../src/license/sdk.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const OTHER = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
  .export({ type: 'spki', format: 'pem' });

const DAY = 86_400_000;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Sign a token exactly the way the store's LicenseTokenService does. */
function sign(claims, { ttlSec = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({ iat: now, exp: now + ttlSec, ...claims });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey, 'base64url')}`;
}

const DEVICE = 'AAAA-BBBB-CCCC';
const base = { licenseKey: 'TOOLS-1111-2222-3333-4444', productSlug: 'ai-video-generation', plan: 'Pro Monthly', features: [], deviceId: DEVICE };
const ask = (file, extra = {}) =>
  licenseState({ file, device: DEVICE, publicKeyPem: PEM, ...extra });

test('a live subscription runs, and says how long it has', () => {
  const expiresAt = new Date(Date.now() + 20 * DAY).toISOString();
  const s = ask({ key: base.licenseKey, token: sign({ ...base, expiresAt, graceUntil: new Date(Date.now() + 27 * DAY).toISOString() }) });
  assert.equal(s.state, 'valid');
  assert.equal(s.daysLeft, 20);
  assert.ok(isRunnable(s));
});

test('a lifetime licence has no countdown to show', () => {
  const s = ask({ key: base.licenseKey, token: sign({ ...base, expiresAt: null, graceUntil: null }, { ttlSec: 30 * 86_400 }) });
  assert.equal(s.state, 'valid');
  assert.equal(s.daysLeft, null);
});

test('an expired subscription keeps working through its grace window', () => {
  // This is the difference between a licence and a hostage situation: the day a card fails, the
  // customer still finishes the video they are in the middle of.
  const s = ask({
    key: base.licenseKey,
    token: sign({ ...base, expiresAt: new Date(Date.now() - 2 * DAY).toISOString(), graceUntil: new Date(Date.now() + 5 * DAY).toISOString() }),
  });
  assert.equal(s.state, 'grace');
  assert.equal(s.reason, 'expired');
  assert.equal(s.daysLeft, 5);
  assert.ok(isRunnable(s), 'grace still runs');
});

test('past the grace window it stops', () => {
  const s = ask({
    key: base.licenseKey,
    token: sign({ ...base, expiresAt: new Date(Date.now() - 30 * DAY).toISOString(), graceUntil: new Date(Date.now() - 23 * DAY).toISOString() }),
  });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'expired');
  assert.ok(!isRunnable(s));
});

test('no licence at all asks for one instead of accusing anybody', () => {
  assert.deepEqual(ask({}), { state: 'missing', reason: 'no-key' });
  assert.equal(ask({ key: base.licenseKey }).state, 'missing', 'a key with no token has never been activated');
});

test('a revoked licence stays revoked even while its token is still valid', () => {
  // The store's verdict outlives the token it was delivered with — otherwise a revoked customer
  // would keep running for up to thirty days on a signature that is technically still good.
  const s = ask({ key: base.licenseKey, status: 'revoked', token: sign({ ...base, expiresAt: null, graceUntil: null }) });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'revoked');
});

test('a licence file copied to another machine does not activate it', () => {
  const s = licenseState({
    file: { key: base.licenseKey, token: sign({ ...base, expiresAt: null, graceUntil: null }) },
    device: 'SOMEBODY-ELSES-MAC',
    publicKeyPem: PEM,
  });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'device-mismatch');
});

test('a token signed by anyone else is not a licence', () => {
  const s = licenseState({
    file: { key: base.licenseKey, token: sign({ ...base, expiresAt: null, graceUntil: null }) },
    device: DEVICE,
    publicKeyPem: OTHER,
  });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'invalid-signature');
});

test('an expired token asks for one online check rather than accusing the customer', () => {
  const s = ask({ key: base.licenseKey, token: sign({ ...base, expiresAt: null, graceUntil: null }, { ttlSec: -60 }) });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'token-expired-offline');
  assert.match(reasonText(s.reason), /kết nối mạng/);
});

test('winding the clock back does not extend a licence', () => {
  // Everything above trusts `Date.now()`. Without this branch, an expired licence could be
  // revived by setting the Mac's clock to last year.
  const token = sign({ ...base, expiresAt: null, graceUntil: null });
  const s = licenseState({
    file: { key: base.licenseKey, token, lastValidatedAt: new Date(Date.now() + 10 * DAY).toISOString() },
    device: DEVICE,
    publicKeyPem: PEM,
  });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'clock-rollback');

  // …but a timezone change or an NTP correction is not an attack: an hour of slack passes.
  const ok = licenseState({
    file: { key: base.licenseKey, token, lastValidatedAt: new Date(Date.now() + 3600_000).toISOString() },
    device: DEVICE,
    publicKeyPem: PEM,
  });
  assert.equal(ok.state, 'valid');
});

test('a build released without its public key locks itself, loudly', () => {
  const s = licenseState({
    file: { key: base.licenseKey, token: sign({ ...base, expiresAt: null, graceUntil: null }) },
    device: DEVICE,
    publicKeyPem: '',
  });
  assert.equal(s.reason, 'no-public-key');
  assert.match(reasonText(s.reason), /tải lại bản mới/);
});

test('verifyLicenseToken refuses rubbish without throwing something unreadable', () => {
  assert.throws(() => verifyLicenseToken('not-a-token', PEM), /không đúng định dạng/);
  // Tamper with the FIRST character of the signature, not the last. A 2048-bit signature is 342
  // base64url characters, and the final character carries only 2 significant bits — flipping it
  // often decodes to the same bytes, so a test that edits the end passes by luck.
  const [header, payload, sig] = sign(base).split('.');
  const tampered = `${header}.${payload}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
  assert.throws(() => verifyLicenseToken(tampered, PEM), /không hợp lệ/);
  // A malformed public key must read as "not verified", never crash the boot path.
  assert.throws(() => verifyLicenseToken(sign(base), 'not a pem'), /không hợp lệ/);
});

test('isWithinGrace treats a lifetime licence as always inside it', () => {
  assert.equal(isWithinGrace({ graceUntil: null }), true);
  assert.equal(isWithinGrace({ graceUntil: new Date(Date.now() + DAY).toISOString() }), true);
  assert.equal(isWithinGrace({ graceUntil: new Date(Date.now() - DAY).toISOString() }), false);
});
