// One table, or seven definitions of "supported language" grow back.
//
// Before src/i18n/languages.js there were seven, and none of them agreed: the video picker
// offered 13 languages, LANG_WPS knew 13, LANG_VOICE_NOTES 11, LANG_FLAGS 10, the subtitle font
// defaults 3, and detectLang() could only distinguish 6. Every layer invented its own fallback
// for the rest, which is how a French video came out voiced as English.
//
// These tests do not check that the table is CORRECT — they check that nothing has drifted away
// from it. A consumer that knows a language the table does not is the divergence starting again.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, indexHtml } from './_source.mjs';
import { LANGUAGES, LANG_CODES, lang, column, isSupported, DEFAULT_LANG } from '../src/i18n/languages.js';
import { LANG_NAME, padMsFor } from '../src/util/lang.js';
import { LANG_WPS } from '../src/providers/llm.js';

const CODES = new Set(LANG_CODES);

test('every row is complete — a missing column is a silent fallback later', () => {
  const REQUIRED = ['code', 'name', 'endonym', 'flag', 'script', 'wordMode', 'wps', 'padMs',
    'lineHeightMin', 'numberLocale', 'sentenceMode', 'connectors', 'metaLabels'];
  for (const row of LANGUAGES) {
    for (const f of REQUIRED) {
      assert.ok(row[f] != null, `language "${row.code}" is missing "${f}"`);
    }
    assert.ok(['space', 'intl'].includes(row.wordMode), `${row.code}: bad wordMode`);
    assert.ok(['punct', 'intl'].includes(row.sentenceMode), `${row.code}: bad sentenceMode`);
    assert.ok(row.connectors.length >= 2, `${row.code}: needs real connector examples`);
    assert.ok(row.wps > 1 && row.wps < 8, `${row.code}: implausible words-per-second`);
  }
  assert.equal(new Set(LANG_CODES).size, LANGUAGES.length, 'duplicate language code');
  assert.ok(isSupported(DEFAULT_LANG), 'the default language must be in the table');
});

test('a language with no spaces between words is marked for the ICU segmenter', () => {
  // Chinese, Japanese and Thai write without word spaces; counting whitespace there produces
  // one token for a whole paragraph, which is how a 5,000-character script audited as ~1 word.
  for (const code of ['zh', 'ja', 'th']) {
    assert.equal(lang(code).wordMode, 'intl', `${code} cannot be counted by whitespace`);
  }
  // Korean does use spaces — it is the one CJK-adjacent language that must NOT be segmented.
  assert.equal(lang('ko').wordMode, 'space');
});

test('the vendored runtime can actually segment those languages', () => {
  // Intl.Segmenter with word granularity needs FULL ICU. A small-icu Node returns the whole
  // string as one segment and every CJK/Thai word count silently collapses to 1.
  const seg = (s, l) => [...new Intl.Segmenter(l, { granularity: 'word' }).segment(s)]
    .filter((x) => x.isWordLike).map((x) => x.segment);
  assert.deepEqual(seg('人工智能改变世界', 'zh'), ['人工', '智能', '改变', '世界']);
  assert.ok(seg('ปัญญาประดิษฐ์เปลี่ยนโลก', 'th').length >= 3, 'Thai word breaking needs full ICU');
});

test('every consumer of a per-language constant stays inside the table', () => {
  assert.deepEqual(Object.keys(LANG_NAME).sort(), [...CODES].sort(), 'LANG_NAME');
  assert.deepEqual(Object.keys(LANG_WPS).sort(), [...CODES].sort(), 'LANG_WPS');
  assert.deepEqual(Object.keys(column('name')).sort(), [...CODES].sort(), 'column()');

  // The frontend keeps its own flag map (it cannot import from src/); it may be a subset while
  // the picker fills in, but it must never name a language the table does not support.
  const flags = sourceOf('public/js/ui/dom.js').match(/LANG_FLAGS = \{([^}]*)\}/)[1];
  for (const [, , code] of flags.matchAll(/(^|[\s,{])([a-z]{2}):/g)) {
    if (code !== 'multi') assert.ok(CODES.has(code), `LANG_FLAGS knows "${code}", the table does not`);
  }
});

test('the video-language picker offers exactly the table, plus auto', () => {
  const html = indexHtml();
  const select = html.slice(html.indexOf('id="cfgLang"'));
  const options = [...select.slice(0, select.indexOf('</select>')).matchAll(/value="([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(options[0], 'auto', 'the first option is auto-detect');
  assert.deepEqual(options.slice(1).sort(), [...CODES].sort(),
    'the picker and the table disagree about which languages exist');
});

test('the breath pad comes from the table, not from a ternary', () => {
  // The 650/400ms split lived in five places written five different ways, one of which sniffed
  // Vietnamese diacritics with an inline regex instead of asking for the language at all.
  assert.equal(padMsFor('vi'), 650);
  assert.equal(padMsFor('fr'), 400);
  assert.equal(padMsFor('xx'), padMsFor(DEFAULT_LANG), 'an unknown code falls back to the house default');
});
