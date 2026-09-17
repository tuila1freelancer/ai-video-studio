// "Render + Ghép" re-renders only what actually moved.
//
// It used to render every clip in the project, every time — most of an hour on a 46-scene 4K video
// to change one scene. The app already knew better: `renderCurrent` is the predicate the pipeline's
// own resume uses, and finalize uses it again to pick which clips to repair before burning
// captions. This path simply never asked.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { renderFingerprint, renderCurrent, fpStamp } from '../src/pipeline/fingerprint.js';

const renderOnly = sourceOf('src/pipeline/render-only.js');

const PROJECT = { id: 'p1', aspect_ratio: '16:9', config: { visualMode: 'hyperframe', subtitleLane: 'final' } };
const scene = (over = {}) => ({ id: 's1', idx: 0, template: 'hyperframe', props: { a: 1 }, duration: 6, ...over });
/** A scene as it looks right after a render: clip on disk, stamped with what it was made from. */
const stamped = (sc, config) => ({ ...sc, video_path: '/tmp/clip.mp4', fp: fpStamp(sc, 'render', renderFingerprint(sc, { config, project: PROJECT })) });

test('the predicate answers the two questions the owner asked', () => {
  const cfg = PROJECT.config;
  const done = stamped(scene(), cfg);
  assert.equal(renderCurrent(done, { config: cfg, project: PROJECT }, cfg).ok, true, 'nothing moved → keep it');
  // HTML: a new spec/template/props moves the digest
  const edited = { ...done, props: { a: 2 } };
  assert.equal(renderCurrent(edited, { config: cfg, project: PROJECT }, cfg).ok, false, 'new props → re-render');
  const retemplated = { ...done, template: 'chapter-break' };
  assert.equal(renderCurrent(retemplated, { config: cfg, project: PROJECT }, cfg).ok, false, 'new template → re-render');
  // …and a config key that shapes the picture
  const restyled = { config: { ...cfg, hyperframeDensity: 'rich' }, project: PROJECT };
  assert.equal(renderCurrent(done, restyled, cfg).ok, false, 'visual config → re-render');
  // …but a concat-only key must NOT: that is the whole point of the split, and getting it wrong
  // here would re-render 46 clips to move a logo.
  const relogoed = { config: { ...cfg, brandKit: { finalOverlay: { enabled: true, cxPct: 0.1 } } }, project: PROJECT };
  assert.equal(renderCurrent(done, relogoed, cfg).ok, true, 'a logo is stamped at the join, not in a clip');
});

test('voice is answered by the clip being GONE, not by a second fingerprint', () => {
  // Both re-voice paths already null `video_path` with the reason written next to them, so a
  // re-voiced scene has no clip to keep and needs no extra stamp to notice.
  assert.match(sourceOf('src/pipeline/stages/tts.js'),
    /DB\.updateScene\(sc\.id, \{ video_path: null \}\); \/\/ the clip carries the old voice/);
  assert.match(sourceOf('src/pipeline/regen.js'), /status: 'tts', video_path: null,/);
  // …which is why the skip's first branch is "is there a clip at all"
  assert.match(renderOnly, /if \(!\(s\.video_path && existsSync\(s\.video_path\)\)\) \{ fresh\.push\(s\); continue; \}/);
});

test('a fresh clip is stamped, or the skip never converges', () => {
  // THE trap. Rendering without stamping leaves the new file next to the OLD fingerprint, so the
  // next run finds the same scene stale and rebuilds it again — an incremental pass that
  // re-renders everything, with extra steps. finalize's repair carries the identical note.
  // now `stampRendered`: the same digest, plus the typesetter version beside it — the digest
  // alone cannot say WHICH harness drew the clip (see typeset-repair.test.js).
  assert.match(renderOnly, /fp: stampRendered\(DB\.getScene\(sc\.id\), renderFingerprint\(sc, \{ config: project\.config \|\| config, project \}\)\)/);
  // and the round trip really is stable: stamp what you rendered, and it reads as current
  const cfg = PROJECT.config;
  const before = scene();
  const after = stamped(before, cfg);
  assert.equal(renderCurrent(after, { config: cfg, project: PROJECT }, cfg).ok, true);
});

test('an explicitly selected scene is an instruction, not a question', () => {
  // 'scenes' stays unconditional — it is also the escape hatch when a clip is wrong in a way no
  // hash can see.
  assert.match(renderOnly, /if \(renderPass && mode !== 'scenes'\) \{/);
  assert.match(renderOnly, /if \(mode === 'scenes' && sceneIds\.length\) scenes = scenes\.filter/);
});

test('the run says what it skipped, and what it will not do for you', () => {
  // A pass that quietly does nothing is indistinguishable from a broken one.
  assert.match(renderOnly, /cảnh cần dựng lại — giữ nguyên \$\{skipped\} cảnh không đổi/);
  // "Render + Ghép" does not run TTS, so an edited-but-unvoiced line is skipped CORRECTLY (the
  // clip still matches the audio on disk) and would otherwise look like the feature ignoring the
  // edit.
  assert.match(renderOnly, /CHƯA thu âm lại — bước này không tự lồng tiếng/);
  assert.match(renderOnly, /ttsFingerprint\(s, \{ config, channel, ai \}\)/);
});

test('the variant lane is untouched — it was already concat-only', () => {
  // A variant layers concat-only settings for ONE run and re-uses the clips; it must not be
  // compared against those overrides, and in fact never reaches the render pass at all.
  assert.match(sourceOf('src/api/routes.js'), /Pipeline\.renderProject\(p\.id, \{ mode: 'concat', configOverrides: overrides/);
  assert.match(renderOnly, /const clipCfg = project\.config \|\| config;/);
});
