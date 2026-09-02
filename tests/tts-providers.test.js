// The voice registry's contract, and the three providers that make it international.
//
// The roster before this was Vietnamese-first by accident: two providers served Vietnamese only,
// one covered five languages, and the widest coverage came from `edge` — which reaches Microsoft's
// engine through Edge's read-aloud endpoint, an undocumented back door with no quota and nobody
// to appeal to when it changes. Azure, Google and Polly are the front doors.
//
// None of these tests touch the network. What they check is the contract: a provider the façade
// cannot call is worse than no provider, because it fails at synthesis time inside a paid run.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, listProviders, getProvider, providerExt, legacyVoice } from '../src/providers/voice/index.js';
import { signRequest, amzDate } from '../src/providers/voice/aws-sig.js';
import { parseSpeechMarks } from '../src/providers/voice/polly.js';
import { escapeXml, ssmlProsody } from '../src/providers/voice/ssml.js';
import { estimateCost } from '../src/core/pricing.js';
import { LANG_CODES } from '../src/i18n/languages.js';
import { readFileSync } from 'node:fs';

const NEW = ['azure', 'google', 'polly'];

test('every provider implements the whole contract the façade calls', () => {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    assert.equal(p.id, id, `${id}: the registry key and the provider id must match`);
    assert.equal(typeof p.name, 'string');
    for (const fn of ['autoVoiceFor', 'listVoices', 'synthesize', 'testConnection']) {
      assert.equal(typeof p[fn], 'function', `${id}.${fn} is missing — the façade calls it`);
    }
    assert.equal(p.synthesize.length >= 4, true, `${id}.synthesize takes (text, voice, cfg, outPath[, opts])`);
    assert.ok(Array.isArray(p.configSchema || []), `${id}: configSchema must be a list`);
    for (const f of p.configSchema || []) {
      assert.ok(f.key && f.label, `${id}: a config field needs a key and a label`);
      assert.ok(['text', 'password', 'select', 'checkbox'].includes(f.type), `${id}.${f.key}: unknown field type`);
    }
    assert.match(providerExt(id), /^\.\w+$/, `${id} must declare a real container`);
  }
});

test('the three cloud providers answer for every language the app offers', () => {
  for (const id of NEW) {
    const p = getProvider(id);
    for (const code of LANG_CODES) {
      const v = p.autoVoiceFor(code);
      assert.ok(v && typeof v === 'string', `${id} has no automatic voice for "${code}"`);
    }
    // An unknown code must still resolve rather than throwing inside a paid run.
    assert.ok(p.autoVoiceFor('xx'));
  }
});

test('a keyed provider stays out of the catalogue until its keys are actually set', async () => {
  const { catalogProviders } = await import('../src/api/services/voice-catalog.js');
  const { providerConfig } = await import('../src/providers/voice/index.js');
  const none = catalogProviders({}, listProviders, providerConfig);
  for (const id of NEW) assert.ok(!none.includes(id), `${id} listed with no credentials`);

  // Polly has neither an apiKey nor a token — it has two secrets, and BOTH are required.
  const half = { providers: { polly: { accessKeyId: 'AKIA' } } };
  assert.ok(!catalogProviders(half, listProviders, providerConfig).includes('polly'),
    'half a credential is not a credential');
  const full = { providers: { polly: { accessKeyId: 'AKIA', secretAccessKey: 's' }, azure: { apiKey: 'k' } } };
  const listed = catalogProviders(full, listProviders, providerConfig);
  assert.ok(listed.includes('polly') && listed.includes('azure'));
});

test('SigV4 is deterministic and scoped to the right service', () => {
  const at = new Date(Date.UTC(2026, 8, 2, 10, 15, 30));
  const args = {
    method: 'POST', host: 'polly.us-east-1.amazonaws.com', path: '/v1/speech',
    body: '{"Text":"hi"}', region: 'us-east-1', service: 'polly',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: at,
  };
  const a = signRequest(args);
  assert.deepEqual(a, signRequest(args), 'the same request must sign the same way twice');
  assert.equal(amzDate(at).amz, '20260902T101530Z');
  assert.match(a.Authorization, /Credential=AKIDEXAMPLE\/20260902\/us-east-1\/polly\/aws4_request/);
  assert.match(a.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
  assert.match(a.Authorization, /Signature=[0-9a-f]{64}$/);
  // A different body must produce a different signature, or the signature is not signing anything.
  assert.notEqual(signRequest({ ...args, body: '{"Text":"ho"}' }).Authorization, a.Authorization);
  assert.notEqual(signRequest({ ...args, region: 'eu-west-1' }).Authorization, a.Authorization);
});

test('Polly speech marks become word cues the caption lane can use', () => {
  // Newline-delimited JSON, one object per mark — not a JSON array, which is the trap.
  const ndjson = [
    '{"time":0,"type":"word","start":0,"end":3,"value":"Ba"}',
    '{"time":320,"type":"sentence","start":0,"end":20,"value":"Ba dấu hiệu"}',
    '{"time":330,"type":"word","start":4,"end":9,"value":"dấu"}',
    '{"time":690,"type":"word","start":10,"end":15,"value":"hiệu"}',
  ].join('\n');
  const words = parseSpeechMarks(ndjson, 1400);
  assert.equal(words.length, 3, 'only word marks become cues');
  assert.deepEqual(words.map((w) => w.word), ['Ba', 'dấu', 'hiệu']);
  assert.equal(words[0].start, 0);
  assert.equal(words[0].end, 0.33, "a word ends where the next one starts");
  assert.equal(words[2].end, 1.4, 'the last word ends with the audio');
  assert.equal(parseSpeechMarks('', 100), null);
  assert.equal(parseSpeechMarks('not json at all', 100), null);
});

test('SSML survives a narration line with markup characters in it', () => {
  // A script about "R&D" or "5 < 10" turns an unescaped request into a parse error.
  assert.equal(escapeXml('R&D on 5 < 10 "really"'), 'R&amp;D on 5 &lt; 10 &quot;really&quot;');
  assert.equal(ssmlProsody('x', {}), 'x', 'no prosody asked for, no wrapper added');
  assert.match(ssmlProsody('x', { rate: 10 }), /<prosody rate="\+10%">x<\/prosody>/);
  assert.match(ssmlProsody('x', { rate: -20, pitch: 3 }), /rate="-20%" pitch="\+3st"/);
  assert.match(ssmlProsody('x', { rate: 999 }), /rate="\+100%"/, 'clamped, not passed through');
});

test('the cost meter knows what the new providers charge', () => {
  for (const id of NEW) {
    assert.ok(estimateCost({ kind: 'tts', provider: id, chars: 10000 }) > 0,
      `${id} bills real money and must not meter as free`);
  }
  assert.equal(estimateCost({ kind: 'tts', provider: 'edge', chars: 10000 }), 0, 'edge is free');
});

test('every paid provider records what it spent', () => {
  // openai and vbee synthesised without calling recordUsage at all, so their spend appeared
  // nowhere: not in the per-video cost meter, not in the budget guardrail that is supposed to
  // downgrade to the free lane when a cap is reached.
  const src = (id) => readFileSync(new URL(`../src/providers/voice/${id}.js`, import.meta.url), 'utf8');
  for (const id of ['elevenlabs', 'larvoice', 'openai', 'vbee', 'azure', 'google', 'polly']) {
    assert.match(src(id), /recordUsage\('tts'/, `${id} spends money without metering it`);
  }
});
