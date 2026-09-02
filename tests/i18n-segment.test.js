// Where one word ends and the next begins, for languages that do not use spaces.
//
// Chinese, Japanese and Thai are written with no spaces, so every whitespace count in this
// codebase returned 1 for a whole paragraph. The worst consequence was not a wrong statistic:
// SCRIPT_MODE_MIN_WORDS routes an input of ≥80 words to light-polish mode, where the owner's
// wording is the deliverable. A 5,000-character Chinese script counted as one word, fell under
// the floor, and was routed to "topic" mode — which throws the owner's script away and writes a
// new video about it.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { words, countWords, sentences, visualWidth, wordJoiner } from '../src/i18n/segment.js';
import { SCRIPT_MODE_MIN_WORDS, sourceSlicer } from '../src/content/master-script.js';
import { scriptBudgetOk, splitSentences } from '../src/providers/llm.js';

const ZH = '人工智能正在改变世界。它让每个人都能更快地工作。你准备好了吗？';
const TH = 'ปัญญาประดิษฐ์กำลังเปลี่ยนโลกและเปลี่ยนวิธีที่เราทำงานทุกวัน';
const VI = 'Ba dấu hiệu giúp các bạn tự tin tăng giá. Đây là điều quan trọng nhất.';

test('segment: a language without spaces is counted by words, not by whitespace', () => {
  assert.equal(ZH.trim().split(/\s+/).length, 1, 'whitespace really does see one token');
  assert.ok(countWords(ZH, 'zh') >= 12, `Chinese words: got ${countWords(ZH, 'zh')}`);
  assert.ok(countWords(TH, 'th') >= 8, `Thai words: got ${countWords(TH, 'th')}`);
  assert.deepEqual(words(ZH, 'zh').slice(0, 4), ['人工', '智能', '正在', '改变']);
});

test('segment: space-separated languages count exactly as they always did', () => {
  // The Vietnamese lane must not move — this is the regression that would matter most.
  assert.equal(countWords(VI, 'vi'), (VI.match(/[\p{L}\p{N}]+/gu) || []).length);
  assert.equal(countWords('one two three', 'en'), 3);
  assert.equal(wordJoiner('vi'), ' ');
  assert.equal(wordJoiner('zh'), '', 'rejoining Chinese words with spaces inserts gaps that are not there');
});

test('segment: an owner script in Chinese reaches the light-polish floor', () => {
  // 40 sentences of real Chinese — unmistakably a detailed script, zero spaces in it.
  const script = '人工智能正在改变我们工作的方式。'.repeat(40);
  assert.ok(script.length > 500);
  assert.equal(script.trim().split(/\s+/).length, 1, 'the old count');
  assert.ok(countWords(script, 'zh') >= SCRIPT_MODE_MIN_WORDS,
    'a long Chinese script must qualify as a script, not be rewritten as a topic');
});

test('segment: sentences come from ICU where punctuation cannot find them', () => {
  assert.deepEqual(sentences(ZH, 'zh').length, 3, 'CJK ends sentences on 。！？');
  assert.equal(sentences(VI, 'vi').length, 2);
  // …and the default, language-free call is the punctuation split it has always been.
  assert.deepEqual(splitSentences(VI), sentences(VI, 'vi'));
});

test('segment: the word-budget gate no longer skips Japanese and Chinese', () => {
  // Both languages used to return true unconditionally — the gate did not run at all.
  const bloated = Array.from({ length: 5 }, () => ({ voice: '人工智能正在改变我们工作的方式并且让每个人都能更快地完成任务。'.repeat(3) }));
  assert.equal(scriptBudgetOk(bloated, 8, 'zh'), false, 'a grossly overlong Chinese script is now caught');
  const sane = Array.from({ length: 5 }, () => ({ voice: '人工智能改变世界。' }));
  assert.equal(scriptBudgetOk(sane, 8, 'zh'), true);
});

test('segment: the source slicer can partition a Chinese script', () => {
  const sents = sentences('人工智能正在改变世界。它让每个人都能更快地工作。你准备好了吗？我们开始吧。', 'zh');
  const slice = sourceSlicer(sents, 2, 'zh');
  const first = slice(1, 1);
  const second = slice(2, 2);
  assert.ok(first && second, 'both halves carry text');
  assert.ok(!(first + second).includes(' '), 'Chinese sentences rejoin without invented spaces');
  // Under whitespace counting every sentence weighed exactly 1, so the cut ignored real length.
  assert.ok(countWords(sents[0], 'zh') > 1);
  assert.equal(sents.length, 4);
});

test('segment: a CJK glyph asks for two columns of caption width', () => {
  assert.equal(visualWidth('人工智能'), 8);
  assert.equal(visualWidth('AIAI'), 4);
});

// ---- captions in a language that writes no spaces ----

test('segment: caption tokens rejoin to exactly the text they came from', async () => {
  const { layoutTokens } = await import('../src/i18n/segment.js');
  // words() drops punctuation, which is right for counting and would delete every 。 from a
  // Chinese caption. The measurer and the ASS writer must tokenise identically or their break
  // indices point at different words.
  for (const [text, code] of [['人工智能正在改变世界。它让每个人都更快。', 'zh'],
    ['Ba dấu hiệu giúp các bạn tự tin.', 'vi'], ['ปัญญาประดิษฐ์เปลี่ยนโลกทุกวัน', 'th']]) {
    const toks = layoutTokens(text, code);
    assert.equal(toks.join(wordJoiner(code)), text, `${code} round-trips losslessly`);
    assert.ok(toks.length > 1, `${code} is breakable at all — a single token can never wrap`);
  }
});

test('segment: sentence-mode subtitles no longer return one cue for a whole Chinese scene', async () => {
  const { rechunkCues } = await import('../src/subtitles/chunk.js');
  const text = '人工智能正在改变世界。它让每个人都能更快地工作。你准备好了吗？';
  const words = [...text].filter((c) => !'。？'.includes(c))
    .map((c, i) => ({ word: c, start: i * 0.2, end: (i + 1) * 0.2 }));
  const cues = rechunkCues([{ start: 0, end: 6, text, words }], { chunk: 'sentence', text, lang: 'zh' });
  assert.ok(cues.length >= 3, `expected one cue per sentence, got ${cues.length}`);
  assert.equal(rechunkCues([{ start: 0, end: 6, text, words }], { chunk: 'sentence', text }).length, 1,
    'without a language the punctuation split still sees one sentence — this was the bug');
});

test('segment: the scene page joins caption words the way the language writes them', async () => {
  const { buildSceneHtml } = await import('../src/animation/index.js');
  const project = { id: 'p', aspect_ratio: '16:9' };
  const scene = { id: 's1', idx: 0, voice_text: 'x', template: 'kinetic-statement', props: { heading: 'G' }, duration: 6, srt_json: [] };
  const capJoin = (c) => (buildSceneHtml(scene, project, c, { total: 3 }).match(/"capJoin":\s*("[^"]*")/) || [])[1];
  assert.equal(capJoin({ enableSubtitles: true, language: 'zh' }), '""');
  assert.equal(capJoin({ enableSubtitles: true, language: 'th' }), '""');
  // Absent for space-separated languages, so their page payload does not move at all.
  assert.equal(capJoin({ enableSubtitles: true, language: 'vi' }), undefined);
  assert.equal(capJoin({ enableSubtitles: true, language: 'en' }), undefined);
});
