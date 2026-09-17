// The interface document is a shell of include markers plus partials; this is the expander that
// turns them back into the one file the browser receives.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandIncludes, assembleIndex } from '../src/util/html-include.js';
import { PATHS } from '../src/config/paths.js';

const FILES = {
  'a.html': 'A-top\n<!--#include "b.html" -->\nA-bottom\n',
  'b.html': '  <b>B</b>\n',
  'loop.html': '<!--#include "loop.html" -->\n',
};
const read = (rel) => FILES[rel];

test('markers are replaced verbatim; the partial keeps its own indentation and loses its final newline', () => {
  assert.equal(expandIncludes(FILES['a.html'], read), 'A-top\n  <b>B</b>\nA-bottom\n');
});

test('markup without markers passes through untouched', () => {
  assert.equal(expandIncludes('<p>plain</p>\n', read), '<p>plain</p>\n');
});

test('a path that escapes the public root is refused, and runaway nesting stops', () => {
  assert.throws(() => expandIncludes('<!--#include "../secret.html" -->', read), /refused/);
  assert.throws(() => expandIncludes('<!--#include "/etc/passwd" -->', read), /refused/);
  assert.throws(() => expandIncludes(FILES['loop.html'], read), /nesting too deep/);
});

test('the shipped shell expands with no marker left and every partial used exactly once', () => {
  const html = assembleIndex(PATHS.publicDir);
  assert.doesNotMatch(html, /<!--#include/);
  const partials = readdirSync(join(PATHS.publicDir, 'partials')).filter((f) => f.endsWith('.html'));
  const shell = readFileSync(join(PATHS.publicDir, 'index.html'), 'utf8');
  const nested = partials.map((f) => readFileSync(join(PATHS.publicDir, 'partials', f), 'utf8')).join('\n');
  for (const f of partials) {
    const uses = (`${shell}\n${nested}`.match(new RegExp(`<!--#include "partials/${f}" -->`, 'g')) || []).length;
    assert.equal(uses, 1, `partials/${f} is included ${uses} times`);
  }
  // The pages and modals are all present at boot — nothing at runtime depends on the split.
  for (const id of ['page-home', 'page-studio', 'page-tutorials', 'settingsModal', 'liveModal', 'grpSubtitle']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
