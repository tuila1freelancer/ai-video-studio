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
import { sourceOf } from './_source.mjs';
import { resolveGuide } from '../src/styleguide/index.js';
import { withScriptFallback, scriptFallback } from '../src/styleguide/script-fonts.js';
import { assStyleFrom } from '../src/subtitles/presets.js';
import { LANG_CODES, lang as langRow } from '../src/i18n/languages.js';
import { familiesForLanguage } from '../src/fonts/registry.js';
import { SCRIPT_PROBES, scriptsOf, coversScript } from '../src/fonts/coverage.js';
import { existsSync, readdirSync } from 'node:fs';

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
  const build = sourceOf('scripts/build-fonts.mjs');
  const manifest = build.slice(build.indexOf('const UI_SUBSETS'), build.indexOf('function cssUrl'));
  for (const subset of ['cyrillic', 'greek', 'thai', 'devanagari']) {
    assert.ok(manifest.includes(subset), `the interface font has no ${subset} subset`);
  }
});

// ---- typography that suits the script, not just the alphabet ----

test('typography: case and tracking are applied only where the script has them', async () => {
  const { buildTemplate, makeCtx } = await import('../src/animation/templates/index.js');
  const { themeFromGuide } = await import('../src/styleguide/index.js');
  const { lang: langRow } = await import('../src/i18n/languages.js');
  const css = (code) => {
    const guide = resolveGuide({ language: code });
    const ctx = makeCtx({ w: 1920, h: 1080, theme: themeFromGuide(guide), script: langRow(code).script });
    return buildTemplate('hyperframe', { guide, html: '<div class="hf-kw">X</div>' }, ctx).css;
  };
  const rule = (c, sel) => (c.match(new RegExp(`\\${sel}\\{[^}]*\\}`)) || [''])[0];

  // Latin, Vietnamese and Cyrillic have case and take tracking — unchanged.
  for (const code of ['vi', 'en', 'ru']) {
    assert.match(rule(css(code), '.hf-kw'), /text-transform:uppercase/, `${code} keeps its uppercase headline`);
    assert.match(rule(css(code), '.hf-label'), /letter-spacing/, `${code} keeps its tracking`);
  }
  // CJK has no case at all, so uppercase is a no-op dressed up as emphasis.
  assert.ok(!/text-transform:uppercase/.test(rule(css('zh'), '.hf-kw')));
  // Thai and Devanagari build letters out of clusters that letter-spacing pulls apart.
  for (const code of ['th', 'hi']) {
    assert.ok(!/letter-spacing/.test(rule(css(code), '.hf-label')), `${code} must not be letter-spaced`);
    assert.ok(!/text-transform:uppercase/.test(rule(css(code), '.hf-kw')));
  }
});

test('typography: the codegen prompt names the right rule for the declared language', async () => {
  const { scriptTextRule } = await import('../src/hyperframe/prompt.js');
  assert.match(scriptTextRule('x', 'hi'), /Devanagari/);
  assert.match(scriptTextRule('x', 'th'), /Thai/);
  assert.match(scriptTextRule('x', 'ru'), /Cyrillic/);
  assert.match(scriptTextRule('x', 'vi'), /Vietnamese/);
  assert.equal(scriptTextRule('x', 'en'), '');
  // A Vietnamese product name inside an English video used to trigger the Vietnamese rule,
  // because the rule was chosen by sniffing the narration rather than by asking the project.
  assert.equal(scriptTextRule('Our tool is called Nguyễn', 'en'), '');
  // Without a language it still falls back to reading the text — using the fixed detector, so
  // Greek, which decomposes to a combining acute, is not claimed as Vietnamese.
  assert.match(scriptTextRule('ปัญญาประดิษฐ์เปลี่ยนโลกทุกวัน'), /Thai/);
  assert.ok(!/Vietnamese/.test(scriptTextRule('Καλημέρα κόσμε από την Ελλάδα σήμερα')));
});

// ---- proof, not assertion: the cmap reader already in the repo, pointed at the right question ----

test('fonts: the catalogue knows a face for every script the app supports', () => {
  // OS-independent on purpose. Whether a family is installed depends on the machine; whether the
  // app can NAME one for a language must not. A language with no candidate at all is a video that
  // renders in whatever the engine falls back to, which is the failure this whole area exists for.
  for (const code of LANG_CODES) {
    const want = langRow(code).script;
    const fams = familiesForLanguage(code).filter((f) => f.scripts.includes(want));
    assert.ok(fams.length, `no family in the catalogue covers ${code} (${want})`);
  }
});

test('fonts: the glyph prober covers every script the language table names', () => {
  for (const code of LANG_CODES) {
    const script = langRow(code).script;
    assert.ok(SCRIPT_PROBES[script], `coverage.js cannot probe "${script}", so ${code} can claim anything`);
  }
});

test('fonts: a vendored face really contains what it claims (skipped where none are built)', () => {
  const dir = new URL('../vendor/fonts/ttf/', import.meta.url);
  if (!existsSync(dir)) return; // vendor/ is gitignored — CI has no font files to read
  const files = readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f));
  assert.ok(files.length, 'a built vendor dir with no faces in it is a broken build');
  for (const f of files) {
    const path = new URL(f, dir).pathname;
    const scripts = scriptsOf(path);
    assert.ok(scripts.includes('latin'), `${f} does not even cover Latin`);
    // The measured claim, not the declared one: this is the reader that caught Archivo Black
    // claiming Vietnamese while missing 11 of 13 probe codepoints.
    if (/BeVietnamPro|Lexend|Montserrat|Oswald|Nunito/i.test(f)) {
      assert.ok(coversScript(path, 'vietnamese'), `${f} is offered for Vietnamese and cannot draw it`);
    }
  }
});
