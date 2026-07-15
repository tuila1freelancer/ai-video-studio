// On-screen beat-label integrity: the shared sanitizer + the fragment gate (Theme E).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLabel, labelIsFragment } from '../src/hyperframe/beats.js';

test('labelIsFragment: a function-word-led label is a fragment', () => {
  assert.equal(labelIsFragment('và điều quan trọng'), true);
});

test('labelIsFragment: a label ending on a preposition is a fragment', () => {
  assert.equal(labelIsFragment('kết quả của'), true);
});

test('labelIsFragment: a content-noun headline is NOT a fragment (no false positive on "cách")', () => {
  // "cách" is in the keyword STOP set but is a perfectly good headline word — the narrow
  // FUNC set must not flag it.
  assert.equal(labelIsFragment('Cách hỏi ChatGPT'), false);
  assert.equal(labelIsFragment('Người dùng thông minh'), false);
});

test('labelIsFragment: single token / number labels are never fragments', () => {
  assert.equal(labelIsFragment('87%'), false);
  assert.equal(labelIsFragment('KẾT QUẢ'), false);
});

test('labelIsFragment: diacritics distinguish content words from function words (no fold collision)', () => {
  // "đăng" must NOT collide with the particle "đang", nor "tự" with the preposition "từ" —
  // folding away tone/vowel marks previously false-flagged these real headlines.
  assert.equal(labelIsFragment('ĐĂNG KÝ KÊNH'), false, '"đăng" (register) ≠ "đang" (particle)');
  assert.equal(labelIsFragment('TỰ ĐÁNH GIÁ'), false, '"tự" (self) ≠ "từ" (from)');
  // the genuine function words still flag
  assert.equal(labelIsFragment('đang chạy nhanh'), true, '"đang" is a real particle lead');
  assert.equal(labelIsFragment('học từ'), true, '"từ" is a real trailing preposition');
});

test('sanitizeLabel: strips leading/trailing stopwords into a clean phrase', () => {
  const out = sanitizeLabel('và điều quan trọng nhất');
  assert.ok(out.length > 0);
  assert.ok(!/^và/i.test(out), 'leading stopword removed');
  assert.equal(labelIsFragment(out), false, 'the sanitized label is not a fragment');
});

test('sanitizeLabel: preserves a number + unit token', () => {
  assert.equal(sanitizeLabel(['10', 'lần']), '10 lần');
});
