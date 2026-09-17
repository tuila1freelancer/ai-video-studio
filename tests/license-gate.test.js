// The gate, the bypass, and the queue.
//
// Three things have to hold at once for the commercial side of this app to be honest:
//   1. an unlicensed copy answers 403 everywhere EXCEPT the two doors it needs;
//   2. the developer bypass is dead inside a shipped bundle;
//   3. a locked copy does not quietly keep rendering the jobs it was left with.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { licenseGate } from '../src/license/gate.js';
import { bypassed, status } from '../src/license/index.js';
import { maskKey } from '../src/license/store.js';


function call(path) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  licenseGate({ path }, res, () => { passed = true; });
  return { passed, code: res.code, body: res.body };
}

test('an unlicensed copy still opens its own front door', async (t) => {
  // /health is what the Swift launcher polls to decide the server is up. Gate it and the window
  // never appears — the customer cannot even reach the screen that asks for a key.
  process.env.TOOLS_PLATFORM_URL = 'http://127.0.0.1:1';
  process.env.TOOLS_STORE_CLIENT_KEY = 'pk_test.secret';
  delete process.env.TOOLS_LICENSE_BYPASS;
  const { invalidate } = await import('../src/license/index.js');
  invalidate();
  t.after(() => {
    delete process.env.TOOLS_PLATFORM_URL;
    delete process.env.TOOLS_STORE_CLIENT_KEY;
    invalidate();
  });

  assert.equal(status().state, 'missing', 'no license.json in the test data dir');
  assert.equal(call('/health').passed, true);
  assert.equal(call('/license/status').passed, true);
  assert.equal(call('/license/activate').passed, true);

  const blocked = call('/projects');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.code, 403);
  assert.equal(blocked.body.error, 'license_required');
  assert.equal(blocked.body.state, 'missing');
  assert.ok(blocked.body.message, 'and it says what to do, not just no');
});

test('a build with no store wired in runs — a developer checkout is not a pirate', () => {
  // Both env vars absent: nothing was ever baked in, so there is no shop to ask.
  assert.equal(status({ fresh: true }).state, 'valid');
  assert.equal(call('/projects').passed, true);
});

test('the developer bypass cannot survive being shipped', (t) => {
  t.after(() => { delete process.env.TOOLS_LICENSE_BYPASS; delete process.env.AVS_DIST; });
  process.env.TOOLS_LICENSE_BYPASS = '1';
  assert.equal(bypassed(), true, 'works from the repo');
  process.env.AVS_DIST = '1';
  assert.equal(bypassed(), false, 'and is dead inside the bundle');
  // AVS_DIST is set by the Swift launcher, inside the app, before node starts — a customer
  // cannot unset it without repackaging the bundle, at which point they have edited the source
  // anyway and the deterrent has done its job.
  assert.match(sourceOf('shell/build-app.sh'), /AVS_DIST/);
});

test('a locked copy stops taking new work but never kills a running render', () => {
  const sched = sourceOf('src/pipeline/scheduler.js');
  assert.match(sched, /if \(!licensed\(\)\) \{\s*\n\s*scheduleTick\(60_000\);\s*\n\s*return;/);
  // The guard sits ahead of claimNextJob and touches nothing that is already running: cutting a
  // customer's video off halfway destroys work they have already paid for.
  assert.ok(sched.indexOf('if (!licensed())') < sched.indexOf('DB.claimNextJob'));
  assert.ok(!/running\.(clear|delete)\(\)/.test(sched.slice(sched.indexOf('if (!licensed())'), sched.indexOf('promoteDueSlots();'))));

  const server = sourceOf('src/server.js');
  assert.match(server, /if \(isRunnable\(license\.status\(\)\)\) \{\s*\n\s*startScheduler\(\);/);
  // …and activating must not mean restarting the app.
  assert.match(server, /license\.licenseEvents\.on\('change'/);
  assert.match(server, /startScheduler\(\);\s*\n\s*\}\);/);
});

test('the gate stands in front of every route, not the ones somebody remembered', () => {
  const routes = sourceOf('src/api/routes.js');
  const mount = routes.indexOf('const r = express.Router();');
  assert.ok(routes.indexOf('r.use(licenseGate);') > mount);
  assert.ok(routes.indexOf('r.use(licenseGate);') < routes.indexOf("r.get('/health'"));
});

test('the version has one source', () => {
  // It used to be spelled out in server.js, package.json and the Info.plist, so a release could
  // ship three different answers to "what version am I?".
  // Read off ROOT, not this file's own directory: a release collapses the whole server into one
  // file at the payload root, where "one directory up" points outside the payload entirely.
  assert.match(sourceOf('src/server.js'), /JSON\.parse\(readFileSync\(join\(ROOT, 'package\.json'\), 'utf8'\)\)\.version/);
  assert.ok(!/const VERSION = '\d/.test(sourceOf('src/server.js')));
  assert.match(sourceOf('shell/build-app.sh'), /package\.json/);
});

test('a tampered copy locks even a build with no store wired in', async (t) => {
  // The file-distribution build ships UNCONFIGURED, so the ordinary gate lets it run. A tamper lock
  // has to bite anyway — otherwise "self-revoke on tamper" would do nothing on the exact build the
  // owner hands out. And the way back is a re-provision, never a deleted file.
  const { markTampered, status, invalidate, forgetLicense } = await import('../src/license/index.js');
  delete process.env.TOOLS_PLATFORM_URL;
  delete process.env.TOOLS_STORE_CLIENT_KEY;
  delete process.env.TOOLS_LICENSE_BYPASS;
  invalidate();
  t.after(() => { forgetLicense(); invalidate(); });

  assert.equal(status({ fresh: true }).state, 'valid', 'unconfigured build runs before tamper');
  markTampered('integrity');
  const s = status({ fresh: true });
  assert.equal(s.state, 'locked');
  assert.equal(s.reason, 'tamper');
  const blocked = call('/projects');
  assert.equal(blocked.code, 403);
  assert.equal(blocked.body.state, 'locked');

  forgetLicense(); // sign-out clears the flag — the recovery door
  invalidate();
  assert.equal(status({ fresh: true }).state, 'valid', 're-provisioning clears the lock');
});

test('nothing user-facing ever prints a whole licence key', () => {
  assert.equal(maskKey('TOOLS-A1B2-C3D4-E5F6-G7H8'), 'TOOLS-••••-••••-••••-G7H8');
  assert.equal(maskKey(null), null);
  assert.match(sourceOf('src/license/index.js'), /key: maskKey\(s\.key\)/);
});
