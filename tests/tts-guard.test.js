// Voice-resolution pinning + speech-duration plausibility gate (both born from a real
// incident: a provider-only channel override dropped the pinned vi voice to catalog order,
// and LarVoice returned 13×-stretched audio that turned a 35s video into ~7 minutes).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVoiceTarget, ttsDurationBounds } from '../src/providers/tts.js';
import { detectLang, resolveLang, padMsFor } from '../src/util/lang.js';

const SETTINGS = {
  provider: 'edge',
  edgeVoice: 'vi-VN-NamMinhNeural',
  langVoices: { vi: { provider: 'larvoice', voice: 'public:3' } },
};

test('resolveVoiceTarget: provider-only override inherits the pinned voice for that provider', () => {
  const t = resolveVoiceTarget(SETTINGS, 'vi', { provider: 'larvoice' });
  assert.deepEqual(t, { pid: 'larvoice', voice: 'public:3' }, 'pinned Anh Quân survives a provider-only override');
});

test('resolveVoiceTarget: explicit override voice still beats the pinned default', () => {
  const t = resolveVoiceTarget(SETTINGS, 'vi', { provider: 'larvoice', voice: 'public:99' });
  assert.deepEqual(t, { pid: 'larvoice', voice: 'public:99' });
});

test('resolveVoiceTarget: pin does NOT leak across providers', () => {
  const t = resolveVoiceTarget(SETTINGS, 'vi', { provider: 'edge' });
  assert.equal(t.pid, 'edge');
  assert.equal(t.voice, 'vi-VN-NamMinhNeural', 'edge falls back to its legacy voice, not the larvoice pin');
});

test('resolveVoiceTarget: no override → per-language default; unknown lang → main provider', () => {
  assert.deepEqual(resolveVoiceTarget(SETTINGS, 'vi', undefined), { pid: 'larvoice', voice: 'public:3' });
  const en = resolveVoiceTarget(SETTINGS, 'en', undefined);
  assert.equal(en.pid, 'edge');
});

test('ttsDurationBounds: 13×-stretched LarVoice audio trips the gate, healthy audio passes', () => {
  // the real defective scene: 155 chars spoken over 130s (vs 8.8s for a healthy sibling)
  const text = 'Làm việc quần quật nhưng thu nhập vẫn lẹt đẹt và bạn sợ tăng giá sẽ mất khách? Xem ngay video này, mình sẽ chỉ ra ba dấu hiệu giúp các bạn tự tin tăng giá.';
  const { min, max } = ttsDurationBounds(text);
  assert.ok(130 > max, `130s must exceed max (${max.toFixed(1)}s)`);
  assert.ok(8.8 > min && 8.8 < max, 'healthy 8.8s take stays inside bounds');
  assert.ok(25 < max, 'a genuinely slow voice (2× slower than normal) still passes');
});

test('ttsDurationBounds: floors keep short texts and CJK safe from false trips', () => {
  const short = ttsDurationBounds('Xin chào');
  assert.equal(short.max, 12, 'short text keeps the 12s floor');
  assert.ok(short.min < 0.5);
  const cjk = ttsDurationBounds('新しい動画へようこそ、今日は三つのポイントを紹介します');
  const latin = ttsDurationBounds('x'.repeat(27));
  assert.ok(cjk.max > latin.max, 'CJK chars carry more speech per char → looser max');
  const empty = ttsDurationBounds('');
  assert.equal(empty.min, 0);
});

// ---- the language a voice is chosen FOR (the French-video incident) ----
//
// B3+4 used to re-detect the language from each scene's own text. detectLang answers 'en' for
// any unaccented Latin script, so a video the owner explicitly marked French resolved to 'en':
// langVoices['fr'] was unreachable no matter what the owner pinned, the breath pad came from the
// non-Vietnamese branch, and the TTS text normaliser was skipped. The declared language now
// travels from resolveLang() all the way into the façade.

const MULTILINGUAL = {
  provider: 'edge',
  edgeVoice: 'vi-VN-NamMinhNeural',
  langVoices: {
    vi: { provider: 'larvoice', voice: 'public:3' },
    fr: { provider: 'elevenlabs', voice: 'fr-native-01' },
  },
};

test('resolveVoiceTarget: a pinned French voice is reachable, not shadowed by the main provider', () => {
  assert.deepEqual(resolveVoiceTarget(MULTILINGUAL, 'fr', undefined),
    { pid: 'elevenlabs', voice: 'fr-native-01' });
  // …and the bug's own signature: had the language been sniffed off unaccented French text,
  // 'en' would arrive here instead and hand the scene to the Vietnamese-configured edge voice.
  assert.equal(resolveVoiceTarget(MULTILINGUAL, 'en', undefined).voice, 'vi-VN-NamMinhNeural');
});

test('the declaration wins over whatever the scene text happens to look like', () => {
  // A French project whose first scenes are still English placeholders, or a product name, or a
  // quoted line. Content is evidence; a declaration is an instruction.
  const stub = 'This is the placeholder line for the opening scene of the video.';
  assert.equal(detectLang(stub), 'en', 'the text really does read as English');
  assert.equal(resolveLang({ language: 'fr' }, [stub]), 'fr', 'the declaration wins anyway');
  assert.equal(padMsFor(resolveLang({ language: 'fr' }, [stub])), 400);
  // A Vietnamese project keeps its measured 650ms pad (P9).
  assert.equal(padMsFor(resolveLang({ language: 'vi' }, [])), 650);
  // With nothing declared, content decides — and now it can actually tell French from English.
  assert.equal(resolveLang({}, ['Il faut savoir que ce sont surtout les questions précises qui donnent les résultats.']), 'fr');
});

// ---- picking a voice from a multilingual provider actually keeps it ----
//
// The Voice Picker writes a `lang:'multi'` choice into settings.tts.voiceId, and legacyVoice()
// read that field back only for openai and elevenlabs. Choosing any Supertonic voice therefore
// resolved to null → 'auto' → autoVoiceFor() → CATALOG[0], so every scene was synthesized with
// M1 no matter which voice the owner clicked, with nothing anywhere saying so.

test('a chosen voice survives for every provider, not just two of them', async () => {
  const { legacyVoice } = await import('../src/providers/voice/index.js');
  const picked = { provider: 'supertonic', voiceId: 'F3', providers: { supertonic: { voice: 'F3' } } };
  assert.equal(legacyVoice(picked, 'supertonic'), 'F3', 'this returned null and the scene got M1');
  assert.equal(resolveVoiceTarget(picked, 'vi', undefined).voice, 'F3');

  // The legacy flat shape still resolves — an install that predates the picker must not move.
  assert.equal(legacyVoice({ edgeVoice: 'vi-VN-NamMinhNeural' }, 'edge'), 'vi-VN-NamMinhNeural');
  assert.equal(legacyVoice({ voice: 'Linh' }, 'say'), 'Linh');
  assert.equal(legacyVoice({ voiceId: 'alloy' }, 'openai'), 'alloy');
  // …and a provider's own slot wins over the shared field, so a stale pick cannot leak across.
  assert.equal(legacyVoice({ voiceId: 'alloy', providers: { edge: { voice: 'en-US-AriaNeural' } } }, 'edge'),
    'en-US-AriaNeural');
});
