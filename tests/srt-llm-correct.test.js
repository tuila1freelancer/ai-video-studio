// P20 — LLM SRT correction lane: fixes whisper mishears while the contract pins EVERY
// timestamp and the block count; any violating reply is discarded (originals ship).
// Offline (no LLM) the lane is a clean no-op.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cuesToSrt, parseSrtReply, applyCorrection, correctCues } from '../src/subtitles/llm-correct.js';

const CUES = [
  { start: 0, end: 1.2, text: 'ây ai đang thay đổi', words: [{ word: 'ây', start: 0, end: 0.3 }] },
  { start: 1.2, end: 2.8, text: 'một trăm lẻ tám nghìn đô', words: [] },
  { start: 2.8, end: 4.0, text: 'mọi thứ rất nhanh', words: [] },
];

test('P20 srt-correct: cuesToSrt → parseSrtReply round-trips blocks and timestamps', () => {
  const srt = cuesToSrt(CUES);
  const parsed = parseSrtReply(srt);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].startMs, 0);
  assert.equal(parsed[1].startMs, 1200);
  assert.equal(parsed[2].endMs, 4000);
  assert.equal(parsed[1].text, 'một trăm lẻ tám nghìn đô');
});

test('P20 srt-correct: applyCorrection fixes text in place, keeps timestamps, rebuilds karaoke words for changed cues', () => {
  const srt = cuesToSrt(CUES).replace('ây ai đang thay đổi', 'AI đang thay đổi').replace('một trăm lẻ tám nghìn đô', '$108,000');
  const fixed = applyCorrection(CUES, parseSrtReply(srt));
  assert.ok(fixed, 'contract-compliant reply accepted');
  assert.equal(fixed[0].text, 'AI đang thay đổi');
  assert.equal(fixed[1].text, '$108,000');
  assert.equal(fixed[2].text, 'mọi thứ rất nhanh');
  // timestamps pinned
  assert.equal(fixed[0].start, 0); assert.equal(fixed[0].end, 1.2);
  assert.equal(fixed[1].start, 1.2); assert.equal(fixed[1].end, 2.8);
  // changed cue got fresh word stamps inside its own span
  assert.ok(fixed[0].words.length >= 3);
  assert.ok(fixed[0].words[0].start >= 0 && fixed[0].words.at(-1).end <= 1.2 + 1e-6);
  // unchanged cue keeps its original words array untouched
  assert.equal(fixed[2].words.length, 0);
});

test('P20 srt-correct: contract violations are rejected (count / timestamp / empty text)', () => {
  const base = parseSrtReply(cuesToSrt(CUES));
  assert.equal(applyCorrection(CUES, base.slice(0, 2)), null, 'dropped block → reject');
  const shifted = base.map((p, i) => (i === 1 ? { ...p, startMs: p.startMs + 200 } : p));
  assert.equal(applyCorrection(CUES, shifted), null, 'shifted timestamp → reject');
  const emptied = base.map((p, i) => (i === 0 ? { ...p, text: '' } : p));
  assert.equal(applyCorrection(CUES, emptied), null, 'emptied text → reject');
});

test('P20 srt-correct: offline (LLM disabled) is a clean no-op — cues return unchanged', async () => {
  const r = await correctCues(CUES, 'AI đang thay đổi …', { llm: { enabled: false } });
  assert.equal(r.corrected, false);
  assert.deepEqual(r.cues, CUES);
});
