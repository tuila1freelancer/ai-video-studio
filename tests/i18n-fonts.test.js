// A font that can actually draw the video.
//
// Nothing outside Latin and Vietnamese is bundled: vendor/fonts/fonts.css carries three
// unicode-ranges and the TTFs staged for the subtitle burn are the same Latin faces. Every style
// preset's font stack is 'Oswald', 'Be Vietnam Pro', sans-serif — so a Chinese, Russian, Thai or
// Hindi video asked the renderer for three faces that cannot draw a single one of its characters
// and took whatever it chose instead, at whatever weight, with nobody told.
//
// src/fonts/registry.js has known which families cover which script, and which of them the OS
// provides, since it was written. It was called from exactly one place: the font-picker route.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveGuide } from '../src/styleguide/index.js';
import { withScriptFallback, scriptFallback } from '../src/styleguide/script-fonts.js';
import { assStyleFrom } from '../src/subtitles/presets.js';
import { LANG_CODES } from '../src/i18n/languages.js';

test('fonts: a non-Latin video gets a face that can draw its script', () => {
  const display = (language) => resolveGuide({ language }).fonts.display;
  assert.match(display('zh'), /PingFang SC/);
  assert.match(display('ja'), /Hiragino Sans/);
  assert.match(display('ko'), /Apple SD Gothic Neo/);
  assert.match(display('ru'), /Helvetica Neue|Segoe UI/);
  assert.match(display('th'), /Thonburi/);
  assert.match(display('hi'), /Kohinoor Devanagari/);
  // Windows names travel in the same stack — the app ships a Windows build.
  assert.match(display('zh'), /Microsoft YaHei/);
  assert.match(display('hi'), /Nirmala UI/);
});

test('fonts: the Latin and Vietnamese lanes do not move', () => {
  // The whole vendored set covers these two, so adding anything would change a shipped render
  // for no reason at all.
  const vi = resolveGuide({ language: 'vi' }).fonts;
  const none = resolveGuide({}).fonts;
  assert.deepEqual(vi, none);
  assert.equal(scriptFallback('vi').length, 0);
  assert.equal(scriptFallback('en').length, 0);
  assert.equal(scriptFallback('fr').length, 0);
});

test('fonts: the guide keeps its own face first, and the generic keyword last', () => {
  // Order is the whole point: a Chinese video keeps Oswald for the Latin words in its headline
  // and only falls to PingFang for the characters Oswald cannot draw.
  const s = withScriptFallback("'Oswald', 'Be Vietnam Pro', sans-serif", 'zh');
  assert.ok(s.indexOf('Oswald') < s.indexOf('PingFang SC'), 'the guide face still wins');
  assert.ok(s.indexOf('PingFang SC') < s.indexOf('sans-serif'), 'the generic stays last');
  assert.ok(s.endsWith('sans-serif'));
  // Idempotent — resolving a guide twice must not stack the fallback twice.
  assert.equal(withScriptFallback(s, 'zh'), s);
});

test('fonts: the subtitle burn names a face for every script it can be asked to draw', () => {
  for (const code of LANG_CODES) {
    const style = assStyleFrom({ language: code, subtitlePreset: 'classic-karaoke' });
    assert.ok(style.font, `${code}: no burn font`);
    assert.equal(style.lang, code, 'the style carries its language so box.js can break lines');
  }
  assert.equal(assStyleFrom({ language: 'th', subtitlePreset: 'classic-karaoke' }).font, 'Thonburi');
  assert.equal(assStyleFrom({ language: 'hi', subtitlePreset: 'classic-karaoke' }).font, 'Kohinoor Devanagari');
  // An explicit pick by the owner still wins over the per-language default (P30).
  assert.equal(assStyleFrom({ language: 'th', subtitlePreset: 'classic-karaoke', subtitleFont: 'Anton' }).font, 'Anton');
});

test('fonts: the app shell carries the subsets its own translations need', () => {
  const build = readFileSync(new URL('../scripts/build-fonts.mjs', import.meta.url), 'utf8');
  const manifest = build.slice(build.indexOf('const UI_SUBSETS'), build.indexOf('function cssUrl'));
  for (const subset of ['cyrillic', 'greek', 'thai', 'devanagari']) {
    assert.ok(manifest.includes(subset), `the interface font has no ${subset} subset`);
  }
});
