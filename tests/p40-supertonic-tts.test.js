// P40-C — the self-hosted Supertonic voice. Pins registration, the request shape the local
// server expects, and the lifecycle helpers. Everything network-facing is stubbed: no server,
// no child process, no audio.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROVIDERS, getProvider, listProviders, providerConfig } from '../src/providers/voice/index.js';
import supertonic from '../src/providers/voice/supertonic.js';
import { supertonicUrl } from '../src/media/tts-server.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('P40-C: supertonic joins the registry as a free, offline provider', () => {
  assert.ok(PROVIDERS.supertonic, 'registered');
  assert.equal(getProvider('supertonic').id, 'supertonic');
  const row = listProviders().find((p) => p.id === 'supertonic');
  assert.equal(row.free, true);
  assert.equal(row.needsNetwork, false, 'runs on the owner\'s machine — nothing leaves it');
  assert.ok(row.configSchema.some((f) => f.key === 'serverUrl'), 'server URL is configurable');
  assert.deepEqual(providerConfig({ providers: { supertonic: { speed: '1.2' } } }, 'supertonic'), { speed: '1.2' });
});

test('P40-C: the server URL defaults to loopback and never keeps a trailing slash', () => {
  assert.equal(supertonicUrl({}), 'http://127.0.0.1:7788');
  assert.equal(supertonicUrl({ serverUrl: 'http://127.0.0.1:9000/' }), 'http://127.0.0.1:9000');
  assert.equal(supertonicUrl({ supertonicServerUrl: 'http://localhost:7788//' }), 'http://localhost:7788', 'reference key name also accepted');
});

test('P40-C: synthesis posts the payload the local server expects, with clamped knobs', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, arrayBuffer: async () => new Uint8Array(2048).buffer };
  };
  try {
    const out = `${process.env.TMPDIR || '/tmp'}/p40_supertonic_${process.pid}.wav`;
    await supertonic.synthesize('xin chào', 'F3', { speed: '9', steps: '99' }, out, { lang: 'vi' }).catch(() => {});
    assert.equal(seen[0].url, 'http://127.0.0.1:7788/v1/tts');
    assert.equal(seen[0].body.voice, 'F3');
    assert.equal(seen[0].body.lang, 'vi');
    assert.equal(seen[0].body.response_format, 'wav');
    assert.equal(seen[0].body.speed, 2, 'speed clamped to the supported range');
    assert.equal(seen[0].body.steps, 32, 'diffusion steps clamped');
    // an unsupported language falls back to Vietnamese rather than erroring at the server
    await supertonic.synthesize('hi', 'auto', {}, out, { lang: 'xx' }).catch(() => {});
    assert.equal(seen[1].body.lang, 'vi');
    assert.equal(seen[1].body.voice, 'M1', "'auto' resolves to a real voice id");
  } finally { globalThis.fetch = realFetch; }
});

test('P40-C: the façade writes .wav for supertonic and passes the detected language', () => {
  const s = src('../src/providers/tts.js');
  assert.match(s, /pid === 'supertonic' \? '\.wav'/, 'container matches what the server returns');
  assert.match(s, /\{ lang: detectLang\(text\) \}/, 'multilingual model needs the language explicitly');
});

test('P40-C: the server lifecycle is exposed as routes and cleaned up on shutdown', () => {
  const routes = src('../src/api/routes.js');
  for (const p of ['/tts/server/status', '/tts/server/start', '/tts/server/stop']) {
    assert.ok(routes.includes(p), `${p} route exists`);
  }
  assert.match(src('../src/server.js'), /stopAllTtsServers\(\)/, 'no orphan process survives the app');
});
