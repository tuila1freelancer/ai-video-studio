// Forced alignment + cue layout invariants (P11: cue schema {start,end,text,words[]}).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignWords } from '../src/media/align.js';
import { groupWordsIntoCues } from '../src/media/whisper.js';

test('alignWords: script words inherit whisper timings; mis-heard words are corrected', () => {
  const script = 'Trí tuệ nhân tạo đang thay đổi mọi thứ';
  // whisper mis-hears "tuệ" as "tuê" and merges nothing; timings are real
  const heard = [
    { start: 0.1, end: 0.3, word: 'Trí' }, { start: 0.3, end: 0.5, word: 'tuê' },
    { start: 0.5, end: 0.8, word: 'nhân' }, { start: 0.8, end: 1.1, word: 'tạo' },
    { start: 1.2, end: 1.5, word: 'đang' }, { start: 1.5, end: 1.8, word: 'thay' },
    { start: 1.8, end: 2.1, word: 'đổi' }, { start: 2.1, end: 2.4, word: 'mọi' },
    { start: 2.4, end: 2.7, word: 'thứ' },
  ];
  const out = alignWords(script, heard, 2.8);
  assert.equal(out.length, 9);
  assert.equal(out.map((w) => w.word).join(' '), script, 'displayed words must be the SCRIPT, never the transcription');
  assert.equal(out[0].start, 0.1);
  assert.equal(out[8].end, 2.7);
  // "tuệ" (unmatched due to mis-hearing) interpolates between Trí(0.3) and nhân(0.5)
  const tue = out[1];
  assert.ok(tue.start >= 0.3 && tue.end <= 0.5 + 1e-9, `interpolated inside the gap, got ${tue.start}-${tue.end}`);
  // monotonic non-overlap
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].end - 1e-9);
});

test('alignWords: refuses garbage transcription (<50% anchors) so estimate can take over', () => {
  const heard = [{ start: 0, end: 1, word: 'hoàn' }, { start: 1, end: 2, word: 'toàn' }, { start: 2, end: 3, word: 'khác' }];
  assert.equal(alignWords('một câu nói không hề liên quan gì cả', heard, 3), null);
});

test('groupWordsIntoCues: breaks at strong punctuation, merges trailing orphans', () => {
  const W = (word, i) => ({ start: i * 0.4, end: i * 0.4 + 0.35, word });
  const words = ['Đây', 'là', 'câu', 'một.', 'Sang', 'câu', 'hai', 'nhé', 'bạn', 'ơi'].map(W);
  const cues = groupWordsIntoCues(words);
  assert.equal(cues[0].text, 'Đây là câu một.', 'strong punctuation ends the cue');
  // orphan-merge: no trailing single-word cue
  assert.ok(cues[cues.length - 1].words.length >= 2, 'no lone-word trailing cue');
  for (const c of cues) {
    assert.ok(Array.isArray(c.words) && typeof c.start === 'number' && typeof c.text === 'string', 'cue schema intact (P11)');
  }
});
