// P43 — UI-surface parity. The route diff (P42) could not see client-side features, so the
// reference app's 406 user-visible controls were checked separately. These pin the two real
// capability gaps that check found. Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planTransitions, TRANSITION_STYLES } from '../src/pipeline/render.js';
import { classifyDrop } from '../public/js/features/dragdrop.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCENES = [{ visual_prompt: '[ROLE] hook' }, { visual_prompt: '[ROLE] proof' }, { visual_prompt: '[ROLE] payoff' }, { visual_prompt: '[ROLE] cta' }];
const plan = (style) => planTransitions({ scenes: SCENES, clipCount: 4, style }).map((t) => t.type);

test('P43: the owner can name ONE transition look, or keep the storytelling doctrine', () => {
  // 'auto' is the default and must keep the role-driven plan exactly as it was
  assert.deepEqual(plan('auto'), ['fade', 'zoomin', 'fadeblack'], 'the doctrine is untouched');
  assert.deepEqual(plan(undefined), ['fade', 'zoomin', 'fadeblack'], 'and it is what you get by default');
  // an explicit style overrides it for every boundary
  assert.deepEqual(plan('circleopen'), ['circleopen', 'circleopen', 'circleopen']);
  assert.deepEqual(plan('none'), ['cut', 'cut', 'cut']);
  // 'varied' rotates DETERMINISTICALLY — the same video must always cut the same way
  assert.deepEqual(plan('varied'), plan('varied'));
  assert.equal(new Set(plan('varied')).size, 3, 'and it actually varies');
  // an unknown style falls back to the doctrine rather than emitting a bad ffmpeg filter
  assert.deepEqual(plan('not-a-transition'), ['fade', 'zoomin', 'fadeblack']);
});

test('P43: every offered style is a real xfade transition the render can execute', () => {
  // these names go straight into `xfade=transition=${type}` — a typo would fail the whole concat
  const FFMPEG_XFADE = new Set(['fade', 'dissolve', 'slideleft', 'slideright', 'circlecrop', 'circleopen',
    'smoothleft', 'smoothright', 'zoomin', 'pixelize', 'radial', 'wipeleft', 'fadeblack', 'fadewhite']);
  for (const s of TRANSITION_STYLES) {
    if (s === 'auto' || s === 'varied' || s === 'none') continue;
    assert.ok(FFMPEG_XFADE.has(s), `${s} must be a real xfade transition`);
  }
  // the UI only offers what the planner accepts
  const html = src('../public/index.html');
  const offered = [...html.matchAll(/<option value="([a-z]+)">(?:[^<]*)<\/option>/g)]
    .map((m) => m[1]).filter((v) => TRANSITION_STYLES.includes(v));
  assert.ok(offered.length >= 8, `the picker offers a real choice, got ${offered.length}`);
  assert.match(src('../public/js/views/config.js'), /transitionStyle: \$\('#cfgTransStyle'\)\?\.value \|\| 'auto'/);
  assert.match(src('../src/pipeline/stages/finalize.js'), /style: config\.transitionStyle \|\| 'auto'/);
});

test('P43: a dropped file is routed by WHAT IT IS, and nothing vanishes silently', () => {
  const k = classifyDrop(['a.png', 'b.JPG', 'clip.mp4', 'song.mp3', 'brand.otf', 'notes.txt', 'x.webp']);
  assert.deepEqual(k.images, ['a.png', 'b.JPG', 'x.webp']);
  assert.deepEqual(k.videos, ['clip.mp4']);
  assert.deepEqual(k.audio, ['song.mp3']);
  assert.deepEqual(k.fonts, ['brand.otf']);
  assert.deepEqual(k.unknown, ['notes.txt'], 'an unsupported file is reported, not dropped on the floor');
  const dd = src('../public/js/features/dragdrop.js');
  assert.match(dd, /bỏ qua \$\{kinds\.unknown\.length\} file không hỗ trợ/, 'and the owner is told');
  // dragenter/leave fire per element — without depth counting the overlay flickers across the page
  assert.match(dd, /depth = Math\.max\(0, depth - 1\)/);
  assert.match(src('../public/js/main.js'), /initDragDrop\(\)/, 'wired into the app');
});
