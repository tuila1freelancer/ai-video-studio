import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walk } from '../scripts/lib/i18n-scan.mjs';
import { stripComments } from '../scripts/lib/msgid.mjs';

// A translation resolved at IMPORT time is frozen in the source language for the life of the
// process — and in the browser it is worse than frozen, because the catalogue is fetched AFTER the
// module is evaluated, so the value is always Vietnamese no matter what the owner chose.
//
// The fix is always the same shape: make it a function, an arrow, or a getter, so the lookup
// happens when the string is drawn. This test holds that line, because nothing about the mistake
// is visible — the code runs, the interface is simply in the wrong language.
const OPENS_BODY = /=>|\bfunction\b|\bget\s+[\w$]+\s*\(|\bset\s+[\w$]+\s*\(/;

/** Top-level statements: a run beginning at column 0 with a declaration keyword. */
function topLevelDeclarations(src) {
  const out = [];
  const re = /^(?:export\s+)?(?:const|let|var)\s[\s\S]*?(?=\n(?:export\s+)?(?:const|let|var|function|class|import|\/\/)|\n\n|$)/gm;
  for (const hit of src.matchAll(re)) out.push({ text: hit[0], index: hit.index });
  return out;
}

test('no interface string is translated at import time — the catalogue is not there yet', () => {
  const offenders = [];
  for (const dir of ['public/js', 'src']) {
    for (const file of walk(new URL(`../${dir}`, import.meta.url).pathname)) {
      if (file.includes('/i18n')) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const decl of topLevelDeclarations(src)) {
        const call = /(?<![\w.$])(?:m\(|tp`)/.exec(decl.text);
        if (!call) continue;
        // Safe when a function body opens before the call: it then runs when something calls it.
        const before = decl.text.slice(0, call.index);
        if (OPENS_BODY.test(before)) continue;
        offenders.push(`${file.split('/').slice(-2).join('/')}: ${decl.text.slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `translated at import:\n${offenders.join('\n')}`);
});
