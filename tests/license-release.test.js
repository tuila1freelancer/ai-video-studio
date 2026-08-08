// The distributable bundle and the one-command release.
//
// None of this can be proven by running it here — a real release needs a production store and an
// Apple Developer ID. What CAN be pinned are the properties whose absence would ship a broken app
// to a paying customer, and every one of them below was a real trap in the dev-only build.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNewer } from '../src/license/update.js';
import { configured, isDist, publicKeyPem, storeUrl } from '../src/license/config.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a shipped build cannot be repointed at another store by an environment variable', (t) => {
  t.after(() => {
    delete process.env.AVS_DIST;
    delete process.env.TOOLS_PLATFORM_URL;
    delete process.env.TOOLS_STORE_PUBLIC_KEY;
  });
  process.env.TOOLS_PLATFORM_URL = 'http://evil.example';
  process.env.TOOLS_STORE_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----fake';
  assert.equal(storeUrl(), 'http://evil.example', 'a developer checkout reads the environment');

  process.env.AVS_DIST = '1';
  assert.equal(isDist(), true);
  assert.equal(storeUrl(), '', 'a shipped build ignores it entirely');
  assert.equal(publicKeyPem(), '', 'and above all ignores a public key handed to it at runtime');
  // Whoever answers "which key signs licences?" can mint them. In a shipped build that answer is
  // compiled in by the release script and nowhere else.
  assert.equal(configured(), false);
});

test('the release bakes the trust anchor and never leaves the key in the tree', () => {
  const rel = src('../scripts/release.mjs');
  assert.match(rel, /BEGIN BAKED CONFIG/, 'it rewrites the marked block');
  assert.match(rel, /\/api\/v1\/public-key/, 'fetched from the same store the build will talk to');
  // The baked file holds a live API key for the length of one build. Restoring it in `finally`
  // is what keeps that key out of a commit when the build fails halfway.
  assert.match(rel, /let restoreConfig = \(\) => writeFileSync\(configPath, config\);/);
  assert.match(rel, /} finally \{\s*\n\s*\/\/[^\n]*\n\s*restoreConfig\(\);/);
  assert.match(rel, /process\.on\('exit', \(\) => restoreConfig\(\)\);/, 'and on a hard exit too');
  assert.match(src('../src/license/config.js'), /storeUrl: '',\n\s*clientApiKey: '',\n\s*publicKeyPem: '',/,
    'the committed file carries no secrets');
});

test('the publisher key uploads and is never the one baked into the app', () => {
  const rel = src('../scripts/release.mjs');
  // Two different keys with two different powers. Baking the publisher key would let any customer
  // replace the binary every other customer downloads.
  assert.match(rel, /clientApiKey: \$\{JSON\.stringify\(clientKey\)\}/);
  assert.ok(!/publisherKey.*BAKED|BAKED.*publisherKey/s.test(rel.split('try {')[0].split('const baked')[1] || ''));
  assert.match(rel, /'x-api-key': publisherKey/);
  assert.match(rel, /await postJson\('\/versions', \{/);
});

test('the distributable bundle carries its own runtime, and refuses to build without one', () => {
  const build = src('../shell/build-app.sh');
  // The Homebrew `node` is an 84 KB stub linked against a dozen dylibs under /opt/homebrew: a
  // bundle carrying it runs on the build machine and crashes on every customer's Mac.
  assert.match(build, /vendor\/node\/bin\/node/);
  assert.match(build, /npm run node:fetch/);
  assert.match(build, /exit 1/);
  assert.match(src('../scripts/fetch-node.mjs'), /SHASUMS256/, 'and the runtime is checksummed');
  assert.match(src('../scripts/fetch-node.mjs'), /actual !== expected/);
});

test('the bundle ships what the app needs and leaves out what it does not', () => {
  const build = src('../shell/build-app.sh');
  assert.match(build, /cp -R src public package\.json package-lock\.json/);
  assert.match(build, /ci --omit=dev/, 'production dependencies only');
  assert.match(build, /for v in ffmpeg gsap libs fonts; do/);
  // vendor/whisper is 547 MB of speech model used only for transcribing imported footage.
  // Bundling it would more than double every customer's download for a feature most never touch.
  assert.ok(!/vendor\/whisper/.test(build.replace(/#[^\n]*/g, '')));
  assert.match(build, /better-sqlite3/, 'and the native module is checked, not assumed');
});

test('a distributed app keeps its data where macOS expects, not inside the bundle', () => {
  const build = src('../shell/build-app.sh');
  assert.match(build, /"AVS_DATA_DIR": \(NSHomeDirectory\(\) as NSString\)\.appendingPathComponent\("Library\/Application Support\/AI Video Studio"\)/);
  assert.match(build, /let PROJECT_ROOT = RES \+ "\/app"/, 'and runs its own copy of the code');
  assert.match(build, /"AVS_DIST": "1"/);
  // Set inside the app before node starts, so nothing in the customer's shell can change what the
  // bundle thinks it is — which is what makes the bypass check meaningful.
  assert.match(src('../shell/main.swift'), /for \(k, v\) in EXTRA_ENV \{ env\[k\] = v \}/);
});

test('an unsigned release says so instead of quietly shipping a build Gatekeeper blocks', () => {
  const rel = src('../scripts/release.mjs');
  assert.match(rel, /BẢN NÀY CHƯA ĐƯỢC NOTARIZE/);
  assert.match(rel, /chuột phải/, 'with the workaround the customer will need');
  assert.match(rel, /notarytool', 'submit'/);
  // Stapling modifies the bundle, so the zip customers download must be rebuilt afterwards.
  const staple = rel.indexOf("'stapler', 'staple'");
  assert.ok(rel.indexOf('ditto', staple) > staple, 'the zip is rebuilt after stapling');
});

test('version comparison is numeric, not alphabetical', () => {
  // `'1.0.10' > '1.0.9'` is false as a string compare, which would hide every tenth release.
  assert.equal(isNewer('1.0.10', '1.0.9'), true);
  assert.equal(isNewer('1.0.9', '1.0.10'), false);
  assert.equal(isNewer('2.0.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('1.1.0', '1.0.99'), true);
  assert.equal(isNewer('', '1.0.0'), false);
});
