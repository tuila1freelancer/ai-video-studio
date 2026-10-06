// Moving the prompt behind an interface must not change one byte of what the model receives.
//
// The seam exists so the doctrine could move to a remote service later (ENGINEERING.md)
// without touching the re-ask loop. That is only true if the local implementation is exactly the
// conversation the loop used to build inline — so this file pins it against buildCodegenPrompt and
// against the two re-ask messages, verbatim.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodegenPrompt } from '../src/hyperframe/prompt.js';
import { normalizeGuide } from '../src/styleguide/index.js';
import { localDoctrine, openDoctrine } from '../src/hyperframe/doctrine.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

const PARAMS = {
  scene: { voice_text: 'Mật khẩu mạnh là chưa đủ', visual_prompt: '', keywords: ['bảo mật'], duration: 6 },
  beats: [], direction: { isClimax: false }, guide: normalizeGuide({}), w: 1080, h: 1920, duration: 6,
  idx: 0, total: 6, density: 'balanced', creativeDirection: '', hookVisual: '',
  captionsOn: true, modeBlocks: [], diversitySalt: 0, language: 'vi',
};

test('a session opens with exactly the prompt the loop used to build', () => {
  const d = localDoctrine(PARAMS);
  assert.deepEqual(d.messages, buildCodegenPrompt(PARAMS));
  assert.equal(d.messages.length, 2, 'system + brief — the two that every re-ask truncates back to');
  assert.equal(openDoctrine(PARAMS).kind, 'local');
});

test('a format re-ask replaces the history with one standing reminder', () => {
  const d = localDoctrine(PARAMS);
  const [system, brief] = d.messages;
  d.reaskIssues({ css: 'x', html: 'y', script: 'z' }, ['first problem']);
  d.reaskFormat();

  assert.equal(d.messages.length, 3);
  assert.deepEqual(d.messages.slice(0, 2), [system, brief], 'the brief must survive every re-ask');
  assert.deepEqual(d.messages[2], {
    role: 'user',
    content: 'Your reply did not match the format. Reply with EXACTLY the three fenced blocks and nothing else:\n@@@CSS@@@\n(css)\n@@@HTML@@@\n(html)\n@@@SCRIPT@@@\n(js)\n@@@END@@@',
  });
});

test('an issue re-ask carries one attempt/fix pair and no older failures', () => {
  const d = localDoctrine(PARAMS);
  d.reaskIssues({ css: 'a{}', html: '<p>', script: 'gsap' }, ['stale one']);
  d.reaskIssues({ css: 'b{}', html: '<h1>', script: 'tl' }, ['off-screen', 'overlap']);

  assert.equal(d.messages.length, 4, 'bounded: system + brief + latest pair only');
  assert.deepEqual(d.messages[2], {
    role: 'assistant',
    content: '@@@CSS@@@\nb{}\n@@@HTML@@@\n<h1>\n@@@SCRIPT@@@\ntl\n@@@END@@@',
  });
  assert.equal(d.messages[3].content,
    'Your scene has problems that must be fixed:\n- off-screen\n- overlap\nReturn the corrected scene in the same @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced format — keep what worked, fix only the listed issues.');
  assert.equal(d.messages.some((m) => m.content.includes('stale one')), false);
});

test('a long attempt is truncated at 5000 chars, as it always was', () => {
  const d = localDoctrine(PARAMS);
  d.reaskIssues({ css: 'x'.repeat(9000), html: '', script: '' }, ['too big']);
  assert.equal(d.messages[2].content.length, 5000);
});

test('the loop no longer owns the prompt or the model call', () => {
  const src = readFileSync(join(REPO, 'src', 'hyperframe', 'codegen.js'), 'utf8');
  assert.doesNotMatch(src, /\bchat\(/, 'the model call belongs to the doctrine');
  assert.doesNotMatch(src, /buildCodegenPrompt/, 'so does the prompt');
  assert.match(src, /doctrine\.ask\(\{ temperature \}\)/);
  assert.match(src, /doctrine\.reaskFormat\(\)/);
  assert.match(src, /doctrine\.reaskIssues\(clean, allIssues\)/);
});
