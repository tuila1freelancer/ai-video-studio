// Repairing videos that were finished before the fix existed.
//
// `__fitVietnamese` repairs the PAGE at render time, and `renderFingerprint` hashes scene props
// and config keys — not the harness — so nothing re-renders on its own. A finished video keeps
// its broken clips until something asks for them again, and this is what asks: it names the
// scenes, so a repair run re-renders 773 clips instead of the 1331 those 54 videos contain.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, indexHtml } from './_source.mjs';
import { typesetRisk, atRiskScenes } from '../src/pipeline/typeset-scan.js';
import { TYPESET_VERSION } from '../src/pipeline/fingerprint.js';

const scene = (props, id = 's1', idx = 0) => ({ id, idx, props });

test('no marks in the drawn text, no work', () => {
  // The pass only ever touches text carrying a combining mark, so a scene without one would
  // re-render to an identical clip. English videos must cost nothing.
  assert.equal(typesetRisk(scene({ html: '<div class="giant">SCALE FAST</div>', css: 'line-height:0.8;' })), null);
  // …and a mark alone is not enough either — the CSS has to have one of the defects
  assert.equal(typesetRisk(scene({ html: '<div>ĐÀ NẴNG</div>', css: 'line-height:1.5;color:#fff' })), null);
});

test('the three mechanisms, each on its own', () => {
  const html = '<div class="g">ĐÀ NẴNG</div>';
  assert.deepEqual(typesetRisk(scene({ html, css: '.g{-webkit-background-clip:text}' })).reasons, ['gradient-text']);
  assert.deepEqual(typesetRisk(scene({ html, css: '.g{line-height:0.8}' })).reasons, ['line-height 0.8']);
  assert.deepEqual(typesetRisk(scene({ html, css: '.g{overflow:hidden}' })).reasons, ['overflow:hidden']);
  // 1.28 is the floor, because the safe line-height runs 1.18–1.41 by face
  assert.equal(typesetRisk(scene({ html, css: '.g{line-height:1.3}' })), null);
  assert.ok(typesetRisk(scene({ html, css: '.g{line-height:1.2}' })));
  // a length is not a ratio — `line-height:1.2px` is nonsense but must not be read as 1.2
  assert.equal(typesetRisk(scene({ html, css: '.g{line-height:40px}' })), null);
});

test('the harness headline counts too, whatever the model wrote', () => {
  // .hf-kw is line-height 1.02 and the DEFAULT guide paints it through background-clip:text, so a
  // chrome headline lost its marks with no help from the model at all. Nobody was looking here.
  const html = '<div class="hf-slot"><div class="hf-kw">ĐÀ NẴNG</div></div>';
  const chrome = { textTreatment: 'chrome', palette: { bg: '#0A0E1A' } };
  assert.deepEqual(typesetRisk(scene({ html, css: '', guide: chrome })).reasons, ['hf-kw chrome']);
  // …but only where the treatment really paints that way
  assert.equal(typesetRisk(scene({ html, css: '', guide: { textTreatment: 'neon', palette: { bg: '#0A0E1A' } } })), null);
  // on a light background the CSS falls back to solid ink, so there is nothing to repaint
  assert.equal(typesetRisk(scene({ html, css: '', guide: { textTreatment: 'chrome', palette: { bg: '#F5F6FA' } } })), null);
});

test('text a template draws from props counts as drawn text', () => {
  // A kinetic-statement scene has no `html` at all — its words live in props.heading/pre/sub.
  assert.ok(typesetRisk(scene({ heading: 'ĐIỂM ĐỘT PHÁ', css: '.x{line-height:1}' })));
  assert.equal(typesetRisk(scene({ heading: 'BREAKTHROUGH', css: '.x{line-height:1}' })), null);
});

test('props arrive as a JSON string from the DB and must still parse', () => {
  const row = { id: 's9', idx: 3, props: JSON.stringify({ html: '<b>NẴNG</b>', css: '.b{line-height:0.9}' }) };
  assert.ok(typesetRisk(row));
  assert.deepEqual(atRiskScenes([row]).map((x) => x.id), ['s9']);
  assert.equal(typesetRisk({ id: 'x', props: 'not json' }), null);
  assert.deepEqual(atRiskScenes(null), []);
});

test('a subset render can finish the job, and says why it may', () => {
  // renderOnly's subset mode deliberately stops at the clips — picking scenes by hand means
  // inspecting them next. The repair already knows its whole list, and two queued jobs would
  // leave a window where the video on disk mixes repaired and unrepaired clips.
  const ro = sourceOf('src/pipeline/render-only.js');
  assert.match(ro, /const doJoin = mode !== 'scenes' \|\| alsoJoin;/);
  // named `alsoJoin` because this module imports `join` from node:path: a parameter called
  // `join` shadows it for the whole function and the render loop calls a boolean.
  assert.doesNotMatch(ro, /, join = false \}/, 'never shadow the path helper');
  assert.match(ro, /variantName = null, alsoJoin = false \}/);
  assert.doesNotMatch(ro, /if \(mode !== 'scenes' && stillUnvoiced\)/, 'the old gate must be gone, not shadowed');
  const routes = sourceOf('src/api/routes.js');
  assert.match(routes, /r\.get\('\/projects\/:id\/typeset-scan'/);
  assert.match(routes, /mode: 'scenes', sceneIds: at\.map\(\(x\) => x\.id\), alsoJoin: true,/);
  // …and it must not redesign the artwork on the way past. finalize regenerates the thumbnail and
  // all six platform covers on every join — 7 LLM calls, ~$0.09 a video, replacing a cover the
  // user may already have uploaded. configOverrides is never written back, so this is one run.
  assert.match(routes, /configOverrides: \{ thumbnailAi: false \}/);
  assert.match(sourceOf('src/pipeline/stages/finalize.js'), /const aiOn = config\.thumbnailAi !== false/, 'the key that gates it');
  // a run in flight is refused rather than queued on top of itself
  assert.match(routes, /if \(\['running', 'queued'\]\.includes\(p\.status\)\) return res\.status\(409\)/);
});

test('the button only exists when there is something to repair', () => {
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /async function syncTypesetButton\(p\) \{/);
  assert.match(studio, /if \(state\.current\?\.id !== p\.id \|\| !r\?\.atRisk\) return;/, 'a slow scan must not light up the wrong project');
  assert.match(studio, /Sửa lỗi tiếng Việt \(\$\{r\.atRisk\} cảnh\)/, 'it promises a number, not a guess');
  assert.match(studio, /ghi đè file hiện tại/, 'and says the video on disk is replaced');
  assert.match(studio, /Không gọi AI, không đổi thiết kế/);
  assert.match(indexHtml(), /id="btnTypeset"/);
});

test('a clip already drawn by the fixed typesetter is not offered again', () => {
  // The render digest cannot answer "which typesetter drew this": it hashes scene props and config
  // keys, never the harness — deliberately, because hashing the harness would invalidate every
  // clip of every video, English included, on any harness edit at all. So the version rides beside
  // the digest, written only where a clip is actually produced.
  const bad = { id: 's', idx: 0, props: { html: '<b>ĐÀ NẴNG</b>', css: '.b{line-height:0.8}' } };
  assert.ok(typesetRisk(bad));
  assert.equal(typesetRisk({ ...bad, fp: { typeset: TYPESET_VERSION } }), null);
  // a pre-existing fp blob from before the stamp existed still counts as unrepaired
  assert.ok(typesetRisk({ ...bad, fp: { render: 'abc', tts: 'def' } }));
});

test('the stamp is written wherever a clip is written, and nowhere else', () => {
  // Three sites produce a clip: the pipeline render stage, the render-only lane, and finalize's
  // missing-clip repair. The migrate branches only correct a digest whose DEFINITION moved — they
  // touch no file, so they must keep the plain stamp or they would claim a repair that never ran.
  for (const f of ['src/pipeline/render-only.js', 'src/pipeline/stages/render.js', 'src/pipeline/stages/finalize.js']) {
    assert.match(sourceOf(f), /fp: stampRendered\(/, `${f} does not stamp the typesetter`);
  }
  assert.match(sourceOf('src/pipeline/render-only.js'), /if \(cur\.migrate\) DB\.updateScene\(s\.id, \{ fp: fpStamp\(s, 'render', cur\.want\) \}\);/);
  assert.match(sourceOf('src/pipeline/fingerprint.js'), /export const TYPESET_VERSION = \d+;/);
  assert.match(sourceOf('src/pipeline/fingerprint.js'), /return \{ \.\.\.\(scene\.fp \|\| \{\}\), render: digest, typeset: TYPESET_VERSION \};/);
});
