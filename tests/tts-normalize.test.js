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

test('normalizeForTts leaves plain text untouched', () => {
  assert.equal(normalizeForTts('một câu bình thường không số'), 'một câu bình thường không số');
  assert.equal(normalizeForTts('a plain sentence with no numbers', { lang: 'en' }), 'a plain sentence with no numbers');
  // A language with no rule table is left alone — the correct behaviour, and what every language
  // except Vietnamese used to get whether it needed rules or not.
  assert.equal(normalizeForTts('85% at 16:9', { lang: 'xx' }), '85% at 16:9');
});

test('normalizeForTts expands the forms every language reads wrong', () => {
  // A bare ratio is a clock time to every voice that meets one, and a d/m/y date is read in the
  // American order by an English voice — those are mistakes, not stylistic differences.
  assert.equal(normalizeForTts('shot at 16:9 on 15/3/2025', { lang: 'en' }), 'shot at 16 to 9 on 3/15/2025');
  assert.equal(normalizeForTts('85% growth', { lang: 'en' }), '85 percent growth');
  assert.equal(normalizeForTts('nur 85% seit 15/3/2025', { lang: 'de' }), 'nur 85 Prozent seit 15.3.2025');
  // Chinese puts the number AFTER 百分之, which a rule capturing one digit turned into 8百分之5.
  assert.equal(normalizeForTts('只有85%的人', { lang: 'zh' }), '只有百分之85的人');
  assert.equal(normalizeForTts('85%の人', { lang: 'ja' }), '85パーセントの人');
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
