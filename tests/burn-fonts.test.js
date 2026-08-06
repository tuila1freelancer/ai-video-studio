// Resolving a font family to a real file BEFORE libass is asked for it.
//
// fontconfig substitutes in silence. Ask for a family it cannot find and it renders the subtitle
// in something else, logs nothing, and the video ships in the wrong typeface — finished, paid-for
// work, discovered by eye or not at all. The browser side already refuses to be quiet about this
// (harness fontChecks); this is the same contract for the burn.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  vendoredFaces, resolveFace, isSystemFamily, prepareBurnFontDir, shapingFor, normFamily,
} from '../src/fonts/files.js';

test('the vendored faces are the same files the browser lane draws with', () => {
  const faces = vendoredFaces();
  assert.ok(faces.length >= 8, `expected the built TTF set, got ${faces.length}`);
  for (const f of faces) {
    assert.ok(existsSync(f.path), `${f.family}-${f.weight} is on disk`);
    assert.ok(f.weight >= 100 && f.weight <= 900);
  }
  assert.ok(faces.some((f) => f.family === 'Anton'));
  assert.ok(faces.some((f) => f.family === 'BeVietnamPro'));
});

test('family names match the way humans type them', () => {
  assert.equal(normFamily('Be Vietnam Pro'), normFamily('BeVietnamPro'));
  assert.equal(normFamily("JetBrains Mono"), 'jetbrainsmono');
  assert.equal(normFamily(null), '');
});

test('weight is matched by distance, not equality', () => {
  // Be Vietnam Pro ships at 500/700/800. A preset asking for 600 must land on the nearest face,
  // not fall through to "no font" and abort a burn that had a perfectly good answer.
  assert.match(resolveFace('Be Vietnam Pro', 800).path, /BeVietnamPro-800\.ttf$/);
  assert.match(resolveFace('Be Vietnam Pro', 600).path, /BeVietnamPro-500\.ttf$/);
  assert.match(resolveFace('Be Vietnam Pro', 750).path, /BeVietnamPro-700\.ttf$/);
  assert.match(resolveFace('Anton', 700).path, /Anton-400\.ttf$/, 'one weight is still an answer');
});

test('system families are allowed through without a fontsdir', () => {
  // CJK / Arabic / Thai faces are 5–20 MB each. Vendoring them would dwarf the repo, and macOS
  // already ships them where fontconfig can see them.
  assert.equal(isSystemFamily('PingFang SC'), true);
  assert.equal(isSystemFamily('Hiragino Sans'), true);
  assert.equal(isSystemFamily('Apple SD Gothic Neo'), true);
  assert.equal(isSystemFamily('Impact'), true);
  assert.equal(isSystemFamily('Definitely Not A Font'), false);
});

test('the burn gets a directory holding exactly one file', () => {
  // Pointing fontsdir at vendor/fonts/ttf would work but leaves the WEIGHT to fontconfig, and
  // three Be Vietnam Pro faces live in there. One file, one answer.
  const work = mkdtempSync(join(tmpdir(), 'avs-burnfont-'));
  try {
    const r = prepareBurnFontDir('Be Vietnam Pro', 800, work);
    assert.equal(r.source, 'vendored');
    assert.ok(existsSync(r.file));
    assert.deepEqual(readdirSync(r.fontsDir).length, 1, 'nothing else for libass to pick');
    // calling twice must be idempotent — a re-concat re-stages the same font
    const again = prepareBurnFontDir('Be Vietnam Pro', 800, work);
    assert.equal(again.file, r.file);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('a system family needs no directory at all', () => {
  const work = mkdtempSync(join(tmpdir(), 'avs-burnfont-'));
  try {
    const r = prepareBurnFontDir('PingFang SC', 700, work);
    assert.equal(r.fontsDir, null, 'let fontconfig do its job');
    assert.equal(r.source, 'system');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('an unknown family stops the burn instead of shipping the wrong one', () => {
  const work = mkdtempSync(join(tmpdir(), 'avs-burnfont-'));
  try {
    assert.throws(
      () => prepareBurnFontDir('Totally Made Up Face', 700, work),
      /không tìm thấy font/,
      'silence here means a video in the wrong typeface',
    );
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('complex scripts get the shaper they need', () => {
  // without shaping=complex, Arabic letters do not join and Devanagari conjuncts fall apart
  assert.equal(shapingFor('ar'), 'complex');
  assert.equal(shapingFor('hi'), 'complex');
  assert.equal(shapingFor('th'), 'complex');
  assert.equal(shapingFor('vi'), null);
  assert.equal(shapingFor('en'), null);
  assert.equal(shapingFor(undefined), null);
});
