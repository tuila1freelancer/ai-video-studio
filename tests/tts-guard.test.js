// Voice-resolution pinning + speech-duration plausibility gate (both born from a real
// incident: a provider-only channel override dropped the pinned vi voice to catalog order,
// and LarVoice returned 13×-stretched audio that turned a 35s video into ~7 minutes).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVoiceTarget, ttsDurationBounds } from '../src/providers/tts.js';

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
