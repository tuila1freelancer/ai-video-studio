// Four things that were already possible and none of which were reachable.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diffConfig, listRenders, recordRender, getRender } from '../src/db/repositories/renders.js';
import { createProject } from '../src/db/repositories/projects.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('an export history exists, and each row says what changed', () => {
  const p = createProject({ title: 'aftercare', topic: 't', config: {} });
  const a = recordRender({ projectId: p.id, path: '/v1.mp4', duration: 60, tier: 'encode', config: { subtitleFont: 'Anton' } });
  const b = recordRender({ projectId: p.id, path: '/v2.mp4', duration: 60, tier: 'copy', config: { subtitleFont: 'Lexend', masterFade: false } });
  const list = listRenders(p.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id, 'newest first');
  assert.deepEqual(list[0].changes, ['masterFade', 'subtitleFont'], 'what moved since the previous export');
  assert.deepEqual(list[1].changes, ['subtitleFont'], 'the first row diffs against nothing');
  assert.equal(getRender(a.id).config.subtitleFont, 'Anton', 'the config snapshot is what "go back" restores');
});

test('a variant is recorded as an alternate cut, not as the video', () => {
  const p = createProject({ title: 'variants', topic: 't', config: {} });
  recordRender({ projectId: p.id, path: '/main.mp4', duration: 60, tier: 'encode', config: {} });
  recordRender({ projectId: p.id, path: '/nologo.mp4', duration: 60, tier: 'copy', config: { logo: null }, variant: 'Không logo' });
  assert.equal(listRenders(p.id)[0].variant, 'Không logo');
  // and finalize must not let it take over as "the" video, or asking for a no-logo cut would
  // quietly replace the one being published
  const fin = src('../src/pipeline/stages/finalize.js');
  assert.match(fin, /if \(!variantName\) DB\.updateProject\(projectId, \{ video_path: res\.path/);
});

test('diffConfig is what the owner would call "what changed"', () => {
  assert.deepEqual(diffConfig({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(diffConfig({ a: 1 }, { a: 2 }), ['a']);
  assert.deepEqual(diffConfig({}, { b: 1, a: 1 }), ['a', 'b'], 'sorted, and additions count');
  assert.deepEqual(diffConfig({ a: { x: 1 } }, { a: { x: 1 } }), [], 'deep equality, not identity');
});

test('a variant costs one join because every setting in it lives in the concat', () => {
  const ac = src('../public/js/features/aftercare.js');
  // The classification moved to pipeline/concat-plan.js, beside the fingerprint that consumes
  // these keys' effects, because the copy in the service had drifted — it was missing
  // `enableSubtitles`, which is what finalize checks before burning captions, so turning
  // subtitles OFF on a finished video reported "không có gì thay đổi" and could not be applied.
  const plan = src('../src/pipeline/concat-plan.js');
  const VARIANT_KEYS = ['logo', 'brandKit', 'bgmPath', 'autoBgm', 'soundDesign', 'watermark', 'concatEncoder'];
  for (const k of VARIANT_KEYS) {
    assert.ok(ac.includes(k), `the variant list uses ${k}`);
    assert.ok(plan.includes(`'${k}'`), `${k} is classified as concat-level work`);
  }
  // …and the service reads it from there rather than keeping a second copy to drift again
  assert.match(src('../src/api/services/change-plan.js'), /import \{ CONCAT_CONFIG_KEYS \} from '\.\.\/\.\.\/pipeline\/concat-plan\.js';/);
  // the overrides are for THIS run only — a second deliverable, not a change of mind
  assert.match(src('../src/pipeline/render-only.js'), /configOverrides \? \{ \.\.\.\(project\.config \|\| \{\}\), \.\.\.configOverrides \}/);
  assert.match(src('../src/api/routes.js'), /variantName: name/);
});

test('the jump reads the timeline the concat wrote, never re-derives it', () => {
  // scene-duration sums are wrong by one crossfade per join, and increasingly wrong the further
  // into the video the owner clicks — which is the failure this whole timeline exists to prevent
  const ac = src('../public/js/features/aftercare.js');
  assert.match(ac, /state\.current\?\.metadata\?\.timeline/);
  assert.ok(!/reduce\(\(a, s\) => a \+ \(s\.duration/.test(ac), 'no hand-rolled offsets');
  assert.match(ac, /Bản dựng này chưa lưu bản đồ thời gian/, 'and says so when a project predates it');
});

test('the check reports and never edits', () => {
  const qc = src('../src/api/services/qc-scan.js');
  assert.match(qc, /It reports\. It never edits\./);
  // the finding that made this exist: a clip on disk that no longer matches the design in the DB
  assert.match(qc, /clip-stale/);
  assert.match(qc, /renderCurrent\(scene, \{ config, project \}, config\)/);
  // no updateScene / updateProject anywhere in the scanner
  assert.ok(!/DB\.update/.test(qc), 'a scan that quietly fixed things would hide what the video contains');
  const routes = src('../src/api/routes.js');
  assert.match(routes, /r\.get\('\/projects\/:id\/qc-scan'/);
});

test('going back does not delete going forward', () => {
  const routes = src('../src/api/routes.js');
  const restore = routes.slice(routes.indexOf("versions/:vid/restore"), routes.indexOf("export-variant"));
  assert.match(restore, /DB\.updateProject\(req\.params\.id, \{ config: v\.config, video_path: v\.path/);
  assert.ok(!/unlink|rmSync/.test(restore), 'the newer export stays on disk and stays listed');
  assert.match(restore, /file của phiên bản này không còn trên đĩa/, 'and a missing file is refused, not half-restored');
});
