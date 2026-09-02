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
import { readFileSync, readdirSync } from 'node:fs';
import { classifyError, failed, coded, ERROR_CLASS } from '../src/core/errors.js';
import { t, setUiLang, uiLang, reloadCatalogues } from '../src/i18n/t.js';
import { PATHS } from '../src/config/paths.js';
import { join } from 'node:path';

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

test('ui: every catalogue carries the same keys as the source language', () => {
  const dir = join(PATHS.publicDir, 'locales');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('guide.'));
  assert.ok(files.includes('vi.json') && files.includes('en.json'));
  const vi = JSON.parse(readFileSync(join(dir, 'vi.json'), 'utf8'));
  const keys = Object.keys(vi);
  assert.ok(keys.length, 'the source catalogue is empty');
  for (const f of files) {
    const cat = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const missing = keys.filter((k) => !(k in cat));
    assert.equal(missing.length, 0, `${f} is missing ${missing.length} keys: ${missing.slice(0, 5)}`);
    const extra = Object.keys(cat).filter((k) => !(k in vi));
    assert.equal(extra.length, 0, `${f} has keys the source does not: ${extra.slice(0, 5)}`);
  }
  reloadCatalogues();
});
