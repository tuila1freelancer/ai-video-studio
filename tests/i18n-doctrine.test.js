// The script engine writes in the video's language — including the parts it writes itself.
//
// Vietnamese was not one language among several here; it was the if-branch, and every other
// language was its else. So English, the app's second language, got no register guidance at all;
// a German video was handed English connector examples and Vietnamese tease-questions as the
// things not to write; and the offline lane — the one that runs with no LLM at all — spoke
// Vietnamese chapter headings and a Vietnamese subscribe line aloud in an English video.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { buildMasterPrompt, LANG_VOICE_NOTES, isMetaLeakVoice, planScenes } from '../src/content/master-script.js';
import { offlineScript } from '../src/providers/llm.js';
import { chapterLabel, phrase } from '../src/i18n/script-phrases.js';
import { LANG_CODES } from '../src/i18n/languages.js';

const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const prompt = (language) => buildMasterPrompt({
  mode: 'topic', input: 'a topic', language,
  plan: planScenes({ videoDuration: 60, sceneDuration: 7, language }),
}).map((m) => m.content).join('\n');

test('doctrine: every language has narration guidance, English included', () => {
  for (const code of LANG_CODES) {
    assert.ok(LANG_VOICE_NOTES[code], `${code} has no voice note`);
  }
  assert.match(LANG_VOICE_NOTES.en, /English/, 'English was the one language the vi/else branch left empty');
  assert.match(LANG_VOICE_NOTES.vi, /mình/, 'the Vietnamese persona survived the move into the table');
});

test('doctrine: a non-Vietnamese prompt carries no Vietnamese', () => {
  for (const code of ['en', 'de', 'ja', 'th']) {
    const p = prompt(code);
    assert.ok(!VIETNAMESE.test(p), `${code}: Vietnamese prose leaked into the prompt`);
  }
  assert.ok(VIETNAMESE.test(prompt('vi')), 'a Vietnamese video still gets its own persona');
});

test('doctrine: connectors are the ones that language actually uses', () => {
  assert.match(prompt('de'), /deshalb/, 'German gets German connectors');
  assert.match(prompt('es'), /por eso/, 'Spanish gets Spanish connectors');
  assert.match(prompt('vi'), /vì vậy/, 'Vietnamese keeps its own');
  assert.ok(!/deshalb/.test(prompt('fr')), 'and only its own');
});

test('doctrine: the on-screen-language rule reaches Vietnamese too', () => {
  // The rule "narration in the target language, the visual brief stays English" used to skip
  // both vi and en. English is the one language it is genuinely redundant for.
  assert.match(prompt('vi'), /visual" field MUST remain in English/);
  assert.ok(!/visual" field MUST remain in English/.test(prompt('en')));
});

test('doctrine: the offline lane speaks the video language, with no LLM at all', () => {
  const source = Array.from({ length: 4 }, (_, i) =>
    `Paragraph ${i + 1} explains one idea clearly and at enough length to count as a real chapter of the talk.`).join('\n\n');
  const en = offlineScript(source, { title: 'T', sceneCount: 20, wordsPerScene: 20, structure: true, language: 'en' });
  const joined = en.scenes.map((s) => `${s.voice} ${s.props?.chapter || ''}`).join(' ');
  assert.ok(!VIETNAMESE.test(joined), `an English offline script spoke Vietnamese: ${joined.slice(0, 200)}`);
  assert.ok(joined.includes('PART 01'), 'the chapter card is labelled in English');
  assert.match(joined, /subscribe/i, 'and so is the closing call to action');
  // The Vietnamese lane is unchanged.
  const vi = offlineScript(source, { title: 'T', sceneCount: 20, wordsPerScene: 20, structure: true, language: 'vi' });
  assert.ok(vi.scenes.some((s) => s.props?.chapter === 'PHẦN 01'));
  assert.equal(chapterLabel('ja', 3), '第 03');
  assert.ok(phrase('xx', 'chapter'), 'an unknown language falls back to English, not to Vietnamese');
});

test('doctrine: production metadata is never spoken, in any language', () => {
  assert.equal(isMetaLeakVoice('Mô tả video: ba cách dùng AI'), true);
  assert.equal(isMetaLeakVoice('Beschreibung: drei Wege KI zu nutzen'), true, 'German metadata leaked before');
  assert.equal(isMetaLeakVoice('Descripción: tres formas de usar la IA'), true);
  assert.equal(isMetaLeakVoice('Description: three ways to use AI'), true);
  assert.equal(isMetaLeakVoice('Hôm nay mình sẽ chỉ cho các bạn ba cách.'), false, 'real narration is not metadata');
});

// ---- research and distribution follow the market, not the house language ----

test('doctrine: the YouTube chapter heading is in the video\'s language, not the interface\'s', () => {
  // The description ships WITH the video, so it follows the video's language — an interface set
  // to Japanese while producing a French video must still write "Chapitres", not "チャプター".
  // It read "Chương" for every language until this was fixed.
  const src = sourceOf('src/pipeline/stages/metadata.js');
  assert.doesNotMatch(src, /📑 Chương/, 'the heading is no longer hardcoded Vietnamese');
  assert.match(src, /phrase\(resolveLang\(config, scs\), 'chapters'\)/, 'it resolves the VIDEO language');
  for (const code of LANG_CODES) {
    const got = phrase(code, 'chapters');
    assert.ok(got && got.trim(), `${code} has a chapter heading`);
  }
  assert.equal(phrase('fr', 'chapters'), 'Chapitres');
  assert.equal(phrase('ja', 'chapters'), 'チャプター');
  assert.notEqual(phrase('de', 'chapters'), phrase('vi', 'chapters'));
});

test('market: trend research asks the channel language\'s own edition of the news', async () => {
  const { newsLocale, FEED_PACKS } = await import('../src/providers/trends.js');
  // hl, gl and ceid have to agree with each other; sending hl=vi to a French channel returned
  // Vietnamese headlines as the research material for a French video.
  assert.deepEqual(newsLocale('fr'), { hl: 'fr', gl: 'FR', ceid: 'FR:fr' });
  assert.deepEqual(newsLocale('pt'), { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt' });
  assert.deepEqual(newsLocale('vi'), { hl: 'vi', gl: 'VN', ceid: 'VN:vi' });
  // An explicit country wins — a Spanish-language channel aimed at Mexico is a real thing.
  assert.equal(newsLocale('es', 'MX').gl, 'MX');
  // An unknown language falls back to English rather than to Vietnamese.
  assert.equal(newsLocale('kl').hl, 'en-US');
  assert.ok(Object.keys(FEED_PACKS).some((k) => k.startsWith('world-')), 'non-Vietnamese feed packs exist');
});

test('market: the platforms an international channel actually posts to', async () => {
  const { PLATFORMS, COVER_SIZES } = await import('../src/publish/platforms.js');
  const ids = PLATFORMS.map((p) => p.id);
  for (const id of ['x', 'linkedin']) assert.ok(ids.includes(id), `${id} is missing`);
  // COVER_SIZES has carried an X canvas since it was written, with no platform to put it on.
  assert.ok(COVER_SIZES.some((c) => c.id === 'x'));
  const x = PLATFORMS.find((p) => p.id === 'x');
  assert.equal(x.fields.find((f) => f.key === 'caption').limit, 280, "X's cap is the whole constraint");
});

// ---- one video, many caption tracks ----

test('captions: a translated cue sheet keeps every timing exactly', async () => {
  const { translateCues, buildVtt } = await import('../src/subtitles/translate.js');
  const cues = [
    { start: 0, end: 1.4, text: 'Ba dấu hiệu' },
    { start: 1.4, end: 3.0, text: 'giúp bạn tự tin tăng giá' },
    { start: 3.0, end: 4.2, text: 'mà không mất khách' },
  ];
  // A model told to "translate these subtitles" merges two cues into one better sentence, and the
  // rest of the video desyncs. The contract is enforced, not requested.
  const llm = { enabled: true, apiKey: 'x', baseUrl: 'http://127.0.0.1:1/v1/chat/completions', model: 'm' };
  await assert.rejects(() => translateCues(cues, { from: 'vi', to: 'en', llm }), /.*/,
    'an unreachable model must fail loudly, never return half a sheet');
  // Same language in, same cues out — and no network touched.
  const same = await translateCues(cues, { from: 'vi', to: 'vi', llm });
  assert.deepEqual(same, cues);
  await assert.rejects(() => translateCues(cues, { from: 'vi', to: 'en', llm: { enabled: false } }), /LLM/);

  const vtt = buildVtt(cues);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.400 --> 00:00:03\.000/, 'VTT uses a dot, SRT a comma');
  assert.equal((vtt.match(/-->/g) || []).length, 3, 'one cue in, one cue out');
});
