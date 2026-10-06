// Neither renderer is allowed to quietly swap in a different typeface.
//
// Both of them will, given the chance. Chrome falls back through the CSS font stack; fontconfig
// substitutes for libass. Neither writes anything to any log. The result is a finished, paid-for
// video in the wrong face, found by eye or not at all.
//
// The probe on the browser side has existed since P30 — and only ever reached `logger.warn`,
// which is to say nowhere the user looks. That is precisely the shape of the wrong-language
// warning that fired 22 times and still shipped 22 scenes in the wrong language. This file pins
// the fix on both sides.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAnimationScene } from '../src/animation/index.js';
import { prepareBurnFontDir } from '../src/fonts/files.js';
import { familyReady } from '../src/fonts/registry.js';


const project = { id: 'nofontproj', aspect_ratio: '16:9' };
const scene = {
  id: 's1', idx: 0, voice_text: 'thử', template: 'kinetic-statement',
  props: { pre: '', heading: 'THỬ', heading2: '', sub: '' }, duration: 3, srt_json: [],
};

test('a named font that is not on the machine stops the render before frame one', async () => {
  // 95 clips in the wrong typeface is not a warning-level event
  await assert.rejects(
    () => renderAnimationScene(scene, project, { subtitleFont: 'Definitely Not Installed' }, { dir: tmpdir() }),
    /chưa có trên máy/,
  );
  await assert.rejects(
    () => renderAnimationScene(scene, project, { fonts: { display: 'Also Not Installed' } }, { dir: tmpdir() }),
    /chữ đồ hoạ/,
  );
});

test('…and a font that IS there does not', async () => {
  // the guard must be about availability, not about being fussy: this must get past the check
  // and fail later, on something else entirely (no browser in a unit test run)
  assert.equal(familyReady('Anton'), true);
  await assert.rejects(
    () => renderAnimationScene(scene, project, { subtitleFont: 'Anton' }, { dir: '/nonexistent-dir-for-this-test' }),
    (err) => !/chưa có trên máy/.test(err.message),
  );
});

test('a substitution that slips through anyway reaches the user, not a debug log', () => {
  const renderer = sourceOf('src/animation/renderer.js');
  assert.match(renderer, /fontMiss = init\.fontMiss/, 'the probe result is kept');
  assert.match(renderer, /opts\.onLog\?\.\(msg\)/, 'and travels back to the caller');
  assert.match(renderer, /duration: await probeDuration\(outPath\) \|\| duration, fontMiss/, 'and out with the result');
  // every render entry point has to pass a channel the user actually sees
  for (const f of ['src/pipeline/stages/render.js', 'src/pipeline/render-only.js', 'src/pipeline/stages/finalize.js']) {
    assert.match(sourceOf(f), /onLog: \(s\) => op\(projectId,/, `${f} forwards it to the run log`);
  }
});

test('the burn side refuses the same way', () => {
  const work = mkdtempSync(join(tmpdir(), 'avs-nosub-'));
  try {
    assert.throws(() => prepareBurnFontDir('Not A Real Face', 700, work), /không tìm thấy font/);
    // and a web-only format is a clear message, not a mystery substitution
    assert.doesNotThrow(() => prepareBurnFontDir('Anton', 400, work));
  } finally { rmSync(work, { recursive: true, force: true }); }
});
