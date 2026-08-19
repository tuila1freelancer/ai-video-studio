// Nothing may reach the browser as a JavaScript FUNCTION.
//
// Puppeteer serialises `page.evaluate(fn)` by calling `fn.toString()` and parsing the result. A
// release runs from V8 bytecode against a blank placeholder source, so toString() hands back the
// right NUMBER of spaces and nothing else — measured: `() => window.__init()` came back as 21
// space characters — and every such call dies on "Passed function cannot be serialized!".
//
// No unit test could see it: the repo run has real source, so the suite was green while the
// release could not render a single frame. This file is the guard that replaces that blind spot.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// Every puppeteer API that serialises its argument by reading the function's source.
const SERIALISING = /\.(evaluate|evaluateHandle|evaluateOnNewDocument|waitForFunction|\$eval|\$\$eval)\(\s*(async\s*)?(\(|function\b|[A-Za-z_$][\w$]*\s*=>)/;

test('page-side code is passed as a string, never as a function', () => {
  const files = execFileSync('/usr/bin/grep', ['-rl', '--include=*.js', 'page.evaluate', join(REPO, 'src')], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  assert.ok(files.length >= 4, 'expected the renderer, validator, subtitle box and screenshot helper');

  const offenders = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (SERIALISING.test(line)) offenders.push(`${relative(REPO, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], 'these would work from the repo and fail in every release');
});

test('the failure mode itself, so the rule keeps its reason', () => {
  // What the release actually sees. Puppeteer runs `new Function('(' + src + ')')` on this.
  const blanked = ' '.repeat('() => window.__init()'.length);
  assert.throws(() => new Function(`(${blanked})`), SyntaxError);
  // And the string form it was replaced with needs no source at all.
  assert.doesNotThrow(() => new Function('return (window.__init())'));
});
