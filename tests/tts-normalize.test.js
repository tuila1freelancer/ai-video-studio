// Vietnamese TTS normalization + prosody hint invariants. Captions keep the ORIGINAL
// text (only the synthesizer hears these expansions) — see stages/tts.js.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForTts, moodOf } from '../src/providers/tts-normalize.js';

test('normalizeForTts expands symbols/units/dates the voices mis-read', () => {
  assert.equal(normalizeForTts('tăng 85% hiệu suất'), 'tăng 85 phần trăm hiệu suất');
  assert.equal(normalizeForTts('giá 50.000đ thôi'), 'giá 50.000 đồng thôi');
  assert.equal(normalizeForTts('khoảng 200 VNĐ'), 'khoảng 200 đồng');
  assert.equal(normalizeForTts('thu về $100 mỗi ngày'), 'thu về 100 đô la mỗi ngày');
  assert.equal(normalizeForTts('ngày 15/3/2025 ra mắt'), 'ngày 15 tháng 3 năm 2025 ra mắt');
  assert.equal(normalizeForTts('tỉ lệ 16:9 chuẩn'), 'tỉ lệ 16 trên 9 chuẩn');
  assert.equal(normalizeForTts('nhiệt độ 30°C'), 'nhiệt độ 30 độ C');
});

test('normalizeForTts leaves plain text untouched and respects non-vi', () => {
  assert.equal(normalizeForTts('một câu bình thường không số'), 'một câu bình thường không số');
  assert.equal(normalizeForTts('85% growth', { lang: 'en' }), '85% growth', 'en text passes through');
});

test('per-channel lexicon applies word-boundary, longest key first', () => {
  const lex = { AI: 'ây ai', 'AI Agent': 'ây ai ây-giừn' };
  assert.equal(normalizeForTts('AI Agent và AI', { lexicon: lex }), 'ây ai ây-giừn và ây ai');
  assert.equal(normalizeForTts('CHAIN không đổi', { lexicon: lex }), 'CHAIN không đổi', 'no mid-word hits');
});

test('moodOf: [MOOD] direction wins; hook/outro positions get sensible defaults', () => {
  assert.equal(moodOf({ visual_prompt: '[MAIN FOCUS] x\n[MOOD] epic urgency', idx: 3 }, 10), 'energetic');
  assert.equal(moodOf({ visual_prompt: '[MOOD] calm reflective', idx: 3 }, 10), 'calm');
  assert.equal(moodOf({ visual_prompt: '', idx: 0 }, 10), 'energetic', 'hook lands with energy');
  assert.equal(moodOf({ visual_prompt: '', idx: 9 }, 10), 'calm', 'warm sign-off');
  assert.equal(moodOf({ visual_prompt: '', idx: 4 }, 10), null, 'middle scenes stay neutral');
});
