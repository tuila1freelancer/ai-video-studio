// A claim about a font file, checked against the font file.
//
// `registry.js` lists the scripts each family serves, by hand, and that list decides which faces
// the owner is offered for a language. It was wrong — and a wrong entry here is invisible: the
// renderer substitutes and ships. So the claim is now checkable, by reading the cmap.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { glyphProbe, missingFor, coversScript, SCRIPT_PROBES } from '../src/fonts/coverage.js';

const ttf = (name) => join(process.cwd(), 'vendor', 'fonts', 'ttf', name);

test('the probe reads real glyphs out of a real file', () => {
  const has = glyphProbe(ttf('BeVietnamPro-800.ttf'));
  assert.ok(has, 'Be Vietnam Pro cmap must be readable');
  for (const ch of 'ĂĐƠƯẠẴẶẾỘỮỸ') assert.ok(has(ch.codePointAt(0)), `Be Vietnam Pro should draw ${ch}`);
  // …and says no to something it genuinely has not got
  assert.equal(has('的'.codePointAt(0)), false, 'a Latin face must not claim Han');
});

test('Archivo Black is the case this exists for', () => {
  // Google Fonts does not offer a Vietnamese subset for it; scripts/build-fonts.mjs asks and gets
  // latin + latin-ext, warns once at build time, and nothing downstream ever heard about it.
  const missing = missingFor(ttf('ArchivoBlack-400.ttf'), 'vietnamese');
  assert.ok(Array.isArray(missing) && missing.length >= 11,
    `expected Archivo Black to be missing most Vietnamese probes, got ${JSON.stringify(missing)}`);
  assert.ok(missing.includes('Ộ') && missing.includes('Ẵ'));
  assert.equal(coversScript(ttf('ArchivoBlack-400.ttf'), 'vietnamese'), false);
  // it is a perfectly good Latin face, and must not be condemned for more than it did
  assert.equal(coversScript(ttf('ArchivoBlack-400.ttf'), 'latin'), true);
});

test('an unreadable file is believed rather than condemned', () => {
  // Refusing a font we merely failed to parse would break more videos than the bug this closes.
  assert.equal(glyphProbe(ttf('does-not-exist.ttf')), null);
  assert.equal(missingFor(ttf('does-not-exist.ttf'), 'vietnamese'), null);
  assert.equal(coversScript(ttf('does-not-exist.ttf'), 'vietnamese'), true);
  assert.deepEqual(missingFor(ttf('BeVietnamPro-800.ttf'), 'klingon'), [], 'a script with no probes is not a failure');
});

test('the Vietnamese probe leads with the stacked marks', () => {
  // A breve or circumflex CARRYING a tone is the first thing a partial subset drops, and the
  // tallest thing the typesetter has to leave room for.
  for (const ch of 'ẴỘẶẾỮ') assert.ok(SCRIPT_PROBES.vietnamese.includes(ch), `${ch} must be probed`);
  assert.ok(SCRIPT_PROBES.vietnamese.length >= 12);
});
