// A helper used but not imported is a module that throws at boot.
//
// It happened: studio.js already imported `t` from i18n.js, so the edit that added setLabel() saw
// an existing import line and did not touch it. initStudio() then threw on its first label write —
// and because it throws mid-function, every event listener AFTER that line was never wired. The
// page still LOOKED right, because the markup it was about to overwrite was already translated.
//
// Bundlers catch this; the dev server does not, because these are native ES modules loaded
// straight from disk. So it is checked here instead.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JS = join(ROOT, 'public', 'js');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Names a module may call only if it imports or defines them. */
const SHARED = ['setLabel', 'uiLang', 'applyDom', 'setUiLanguage', 'toast', 'esc', 'icon', 'switchPage'];

test('every shared helper a frontend module calls is one it can reach', () => {
  const problems = [];
  for (const file of walk(JS)) {
    const src = readFileSync(file, 'utf8');
    const known = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const part of m[1].split(',')) known.add(part.trim().split(/\s+as\s+/).pop().trim());
    }
    for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) known.add(m[1]);
    for (const name of SHARED) {
      // ASCII boundary on BOTH sides: a Vietnamese word ending in "t" followed by " (" is not a
      // call to t(), and a first pass at this check said it was.
      const called = new RegExp(`(?:^|[^.\\w$])${name}\\s*\\(`).test(src);
      const defined = new RegExp(`(?:function|const|let|var)\\s+${name}\\b`).test(src);
      if (called && !known.has(name) && !defined) {
        problems.push(`${relative(ROOT, file)} calls ${name}() without importing it`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the i18n runtime exports what the rest of the frontend imports from it', () => {
  const api = readFileSync(join(JS, 'i18n.js'), 'utf8');
  for (const name of ['t', 'uiLang', 'initI18n', 'applyDom', 'setUiLanguage', 'setLabel']) {
    assert.match(api, new RegExp(`export (?:async )?function ${name}\\b`), `i18n.js does not export ${name}`);
  }
});
