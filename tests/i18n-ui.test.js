// The interface language — a different axis from the video language, and the reason the error
// taxonomy had to be rebuilt before a single server string could be translated.
//
// classifyError() decided a failure's class by regex-matching Vietnamese substrings inside the
// message: 'chưa cấu hình', 'không tìm thấy ffmpeg'. Translating any of the 85 Vietnamese
// `throw new Error(…)` sites would have dropped those errors into the default branch —
// 'transient' — and bought each one a pointless auto-resume, with nothing anywhere saying so.
// The file's own JSDoc recorded the assumption out loud: "UI text stays Vietnamese".
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { checkCatalogue } from '../scripts/lib/locale-check.mjs';
import { classifyError, failed, coded, ERROR_CLASS } from '../src/core/errors.js';
import { t, setUiLang, uiLang } from '../src/i18n/t.js';
import { PATHS } from '../src/config/paths.js';
import { LANG_CODES } from '../src/i18n/languages.js';
import { join } from 'node:path';
import { indexHtml } from './_source.mjs';

test('errors: the class comes from a code, not from the wording', () => {
  // The same failure, said three ways, in three languages.
  for (const message of ['LarVoice: chưa cấu hình API Key', 'LarVoice: API key not configured', 'LarVoice: APIキーが未設定です']) {
    const c = classifyError(failed('config.no-key', message));
    assert.equal(c.cls, 'config', `wording changed the class: ${message}`);
    assert.equal(c.retryable, false, 'a config error must never buy an auto-resume');
    assert.equal(c.code, 'config.no-key');
  }
});

test('errors: third-party failures still classify by their own wording', () => {
  // Node, ffmpeg and provider HTTP errors carry no code of ours and never will.
  assert.equal(classifyError(new Error('spawn ffmpeg ENOENT')).cls, 'resource');
  assert.equal(classifyError(new Error('HTTP 429 too many requests')).cls, 'rate-limit');
  assert.equal(classifyError(new Error('invalid_api_key')).cls, 'config');
  // …and an unknown one defaults to transient, so a misclassification can never SUPPRESS a
  // resume that would have worked.
  const unknown = classifyError(new Error('something nobody predicted'));
  assert.equal(unknown.cls, 'transient');
  assert.equal(unknown.retryable, true);
});

test('errors: every declared code maps to a real class', () => {
  const classes = new Set(['transient', 'rate-limit', 'config', 'resource']);
  for (const [code, cls] of Object.entries(ERROR_CLASS)) {
    assert.ok(classes.has(cls), `code "${code}" claims unknown class "${cls}"`);
    assert.equal(classifyError(coded(new Error('x'), code)).cls, cls);
  }
});

test('ui: the hint is spoken in the interface language', () => {
  const before = uiLang();
  try {
    setUiLang('vi');
    assert.match(classifyError(new Error('x')).hint, /Lỗi tạm thời/);
    setUiLang('en');
    assert.match(classifyError(new Error('x')).hint, /temporary error/i);
    // An unsupported code falls back to the house default rather than to a blank string.
    assert.equal(setUiLang('kl'), 'vi');
  } finally { setUiLang(before); }
});

test('ui: a missing key shows itself, and placeholders are filled', () => {
  const before = uiLang();
  try {
    setUiLang('en');
    // Returning the KEY is deliberate: a missing translation must look obviously wrong in the
    // interface, not silently blank a button.
    assert.equal(t('nothing.like.this'), 'nothing.like.this');
    assert.equal(t('x {n} y {m}', { n: 1, m: 'two' }), 'x 1 y two');
    assert.equal(t('keep {unknown}', { n: 1 }), 'keep {unknown}', 'an unfilled placeholder is left alone');
  } finally { setUiLang(before); }
});

test('ui: a catalogue is consistent with the source, and never stale', () => {
  // Completeness and correctness are different things here. A MISSING key degrades exactly the
  // way the design intends — the markup's own Vietnamese shows through — so a half-translated
  // language is a known state, not a defect. A key the source no longer has, a dropped
  // placeholder or a label three times too long for its button are defects, and they are silent.
  const dir = join(PATHS.publicDir, 'locales');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.includes('vi.json'), 'the source catalogue must exist');

  for (const prefix of ['', 'guide.']) {
    const sourceFile = join(dir, `${prefix}vi.json`);
    if (!existsSync(sourceFile)) continue;
    const source = JSON.parse(readFileSync(sourceFile, 'utf8'));
    assert.ok(Object.keys(source).length, `${prefix}vi.json is empty`);
    for (const f of files.filter((x) => x.startsWith(prefix) && x !== `${prefix}vi.json`)) {
      if (prefix === '' && f.startsWith('guide.')) continue;
      const code = f.replace(prefix, '').replace('.json', '');
      const cat = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const present = Object.fromEntries(Object.entries(cat).filter(([k]) => k in source));
      const problems = checkCatalogue(
        Object.fromEntries(Object.keys(present).map((k) => [k, source[k]])), present, code,
      );
      assert.deepEqual(problems, [], `${f}: ${problems.slice(0, 4).join(' | ')}`);
      const stale = Object.keys(cat).filter((k) => !(k in source));
      assert.deepEqual(stale, [], `${f} carries ${stale.length} keys the source no longer has`);
    }
  }
});

// The languages the user has declared finished. A code moves in here when its catalogue is
// complete, and from then on a missing key is a build failure rather than a fallback.
const SHIPPED = LANG_CODES;

test('ui: a language declared shipped is actually complete, interface and manual', () => {
  const dir = join(PATHS.publicDir, 'locales');
  for (const prefix of ['', 'guide.']) {
    const source = JSON.parse(readFileSync(join(dir, `${prefix}vi.json`), 'utf8'));
    for (const code of SHIPPED) {
      if (code === 'vi') continue;
      const file = join(dir, `${prefix}${code}.json`);
      assert.ok(existsSync(file), `${prefix}${code}.json does not exist, but ${code} is declared shipped`);
      const cat = JSON.parse(readFileSync(file, 'utf8'));
      const missing = Object.keys(source).filter((k) => !(k in cat));
      assert.deepEqual(missing.slice(0, 5), [],
        `${prefix}${code} is declared shipped but is missing ${missing.length} keys`);
    }
  }
});

test('ui: the markup carries a key for every string a translator must reach', () => {
  const html = indexHtml(); // the shell plus every partial — what the browser is sent
  const keyed = (html.match(/data-i18n[a-z-]*="/g) || []).length;
  assert.ok(keyed > 450, `only ${keyed} nodes carry a translation key`);
  const source = JSON.parse(readFileSync(join(PATHS.publicDir, 'locales', 'vi.json'), 'utf8'));
  // Every key the markup names must exist, or the interface shows a raw key where a label goes.
  for (const m of html.matchAll(/data-i18n[a-z-]*="([^"]+)"/g)) {
    assert.ok(m[1] in source, `index.html names "${m[1]}", the catalogue does not have it`);
  }
});
