// Editing the output config of a FINISHED video, and being able to see it.
//
// The cost table could always answer "what would this edit cost". Reaching it was the problem: it
// sat behind three doors — the Resume button, which silently becomes an apply button once a project
// is done; a button inside the subtitle panel; and a confirm dialog that only fires when a Brand
// Kit is SAVED. Change the transition style, the music bed, the master fade or the encoder and
// nothing anywhere said the finished video no longer matched its own settings.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONCAT_CONFIG_KEYS } from '../src/pipeline/concat-plan.js';
import { sourceOf, indexHtml } from './_source.mjs';


test('every setting the final assembly reads is classified as final-assembly work', () => {
  // A key MISSING from this list is not a wrong estimate — it is the opposite. The change queue
  // reports "không có gì thay đổi" and the edit CANNOT BE APPLIED AT ALL.
  //
  // `enableSubtitles` was missing, and finalize checks exactly that before burning captions
  // (`config.subtitleLane === 'final' && config.enableSubtitles !== false`), so switching subtitles
  // off on a finished video was unreachable: the panel accepted it, the plan said nothing had
  // changed, the captions stayed. `platformCovers` was missing the same way.
  for (const k of ['enableSubtitles', 'platformCovers', 'bgmVol', 'transitions', 'transitionStyle',
    'masterFade', 'concatEncoder', 'brandKit', 'logo', 'watermark', 'bgmPath', 'autoBgm', 'autoSfx',
    'soundDesign', 'thumbnailAi']) {
    assert.ok(CONCAT_CONFIG_KEYS.includes(k), `${k} would be silently unapplicable`);
  }
  // The clip-level keys must NOT be here — claiming a re-render costs one join is the same lie
  // pointing the other way.
  for (const k of ['visualMode', 'hyperframe', 'resolutionScale', 'styleId', 'sceneDuration']) {
    assert.ok(!CONCAT_CONFIG_KEYS.includes(k), `${k} costs renders, not a join`);
  }
  // one home for the list, imported by the service rather than copied into it
  const plan = sourceOf('src/api/services/change-plan.js');
  assert.match(plan, /import \{ CONCAT_CONFIG_KEYS \} from '\.\.\/\.\.\/pipeline\/concat-plan\.js';/);
  assert.doesNotMatch(plan, /const CONCAT_KEYS = \[/, 'the drifted copy is gone');
});

test('the finished-video state is visible while the owner edits, not hidden behind a button', () => {
  const pc = sourceOf('public/js/features/pending-changes.js');
  // ONE delegated listener over the whole config column: a setting added later inherits this,
  // which is precisely the property whose absence let the three-door version drift.
  assert.match(pc, /for \(const ev of \['change', 'input'\]\) col\.addEventListener\(ev, \(\) => schedulePendingCheck\(\), true\);/);
  assert.match(indexHtml(), /id="pendingBar"/);
  assert.match(sourceOf('public/css/app.css'), /\.pending-bar\{position:sticky/, 'it must not scroll away mid-edit');
  // only a finished, idle video can be out of date with its own settings
  assert.match(pc, /p\?\.id && p\.video_path && !\['running', 'queued'\]\.includes\(p\.status\)/);
});

test('a cheap edit applies from the bar; an expensive one has to be looked at first', () => {
  const pc = sourceOf('public/js/features/pending-changes.js');
  // concat-only → one join, no API credit, and it writes a NEW file, so there is nothing to undo
  assert.match(pc, /go\.textContent = plan\.concatOnly \? `🔗 Ghép lại/);
  assert.match(pc, /bar\.dataset\.mode = plan\.concatOnly \? 'join' : 'plan';/);
  // anything that re-renders clips or re-voices scenes opens the cost table instead of starting
  assert.match(pc, /if \(bar\.dataset\.mode !== 'join'\) \{ openChangePlan\(\); return; \}/);
  assert.match(pc, /apply-changes/);
  // and re-voicing is called out in the words that matter
  assert.match(pc, /tốn tiền API/);
});

test('a stale answer never overwrites a fresh one', () => {
  // The panel fires on every keystroke and slider tick. Two ways an answer can be stale by the
  // time it lands — the owner kept typing, or they opened a different project — and both lose.
  const pc = sourceOf('public/js/features/pending-changes.js');
  assert.match(pc, /const mine = \+\+seq;/);
  assert.match(pc, /if \(mine !== seq \|\| state\.current\?\.id !== forProject\) return;/);
  assert.match(pc, /if \(key === lastSent\) return;/, 'an event that changed nothing costs no request');
  assert.match(pc, /const SETTLE_MS = 550;/);
});

test('the bar is re-asked at the two moments the config panel cannot report', () => {
  // The brand kit lives on the CHANNEL, so saving one moves nothing inside the config column…
  assert.match(sourceOf('public/js/features/brandkit.js'),
    /\(await import\('\.\/pending-changes\.js'\)\)\.schedulePendingCheck\(\{ now: true \}\);/);
  // …and a run starting or finishing changes what "pending" means without any edit at all
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /function updateStatusBadge\(status\) \{[\s\S]{0,340}schedulePendingCheck\(\{ now: true \}\)/);
  assert.match(studio, /resetPendingCheck\(\);/, 'opening another project forgets the previous answer');
});
