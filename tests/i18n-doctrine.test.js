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
