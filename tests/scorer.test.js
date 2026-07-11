// Deterministic script quality gate ("B8 for words") invariants.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreScript } from '../src/content/scorer.js';

const cfg = { language: 'vi', sceneDuration: 7 }; // budget ≈ 31 từ

const S = (idx, voice_text) => ({ idx, voice_text });
const GOOD = 'Hôm nay mình sẽ chia sẻ với các bạn một phương pháp làm việc hiệu quả mà mình đã áp dụng suốt ba năm qua và nó thực sự thay đổi cách mình quản lý thời gian mỗi ngày.';

test('a clean script passes with no issues', () => {
  const r = scoreScript([S(0, GOOD), S(1, GOOD.replace('phương pháp', 'công cụ').replace('ba năm', 'hai năm').replace('thời gian', 'công việc').replace('làm việc', 'tư duy').replace('quản lý', 'sắp xếp'))], cfg);
  assert.equal(r.issues.filter((i) => i.type !== 'repetition').length, 0);
});

test('lang-leak: an English scene inside a Vietnamese video is flagged', () => {
  const r = scoreScript([S(0, GOOD), S(1, 'This entire sentence is in English and clearly does not belong here in this Vietnamese video at all today.')], cfg);
  assert.ok(r.issues.some((i) => i.idx === 1 && i.type === 'lang-leak'));
});

test('truncated: a clause repairJson closed mid-sentence is flagged', () => {
  const r = scoreScript([S(0, 'Mình sẽ nói cho các bạn nghe về ba điều quan trọng nhất khi')], cfg);
  assert.ok(r.issues.some((i) => i.type === 'truncated'));
});

test('word budget: a 5-word scene in a 7s slot is under-budget', () => {
  const r = scoreScript([S(0, 'Câu này quá ngắn rồi.')], cfg);
  assert.ok(r.issues.some((i) => i.type === 'under-budget'));
});

test('repetition: a near-verbatim duplicate scene is flagged', () => {
  const r = scoreScript([S(0, GOOD), S(1, GOOD)], cfg);
  assert.ok(r.issues.some((i) => i.idx === 1 && i.type === 'repetition'));
});
