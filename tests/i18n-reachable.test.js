import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The sweep that made every interface string translatable is worth exactly as much as the thing
// that stops the next one from slipping. A string only has to be built the ordinary way — put in
// an object, written to textContent, interpolated into a sentence — to be invisible to the
// catalogue again, and nothing about the mistake shows up until somebody runs the app in Japanese.
//
// So the audit runs here. It reports what no catalogue can reach, in the markup, in the browser
// modules and on the server. The catalogues' own completeness is i18n-ui.test.js's job.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('every string the interface shows can be reached by a catalogue', () => {
  let out;
  let failed = false;
  try {
    out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'audit-i18n.mjs'), '--verbose'],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    failed = true;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  // The catalogue line is the other test's; a language mid-translation must not fail this one.
  const unreachable = out.split('\n').filter((l) => /^✗ (?:public\/index\.html|public\/js|src) /.test(l));
  assert.deepEqual(unreachable, [], `\n${out}`);
  if (!failed) assert.match(out, /nothing unreachable/);
});
