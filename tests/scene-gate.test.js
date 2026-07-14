// Scenes-first pipeline: duration estimator, timing seed, time-warp math, and the FX
// coordinate conversion that keeps caption-driven motion on real time under the warp.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateSpeechDuration, estimateWordTiming } from '../src/providers/subtitle.js';
import { LANG_WPS } from '../src/providers/llm.js';
import { templateTimeScale } from '../src/animation/index.js';

test('estimateSpeechDuration: within ~12% of measured LarVoice reality', () => {
  // the repaired real project: 5 vi scenes, 148–169 chars ≈ 28–33 words → 9.0–10.1s padded
  const text = 'Làm việc quần quật nhưng thu nhập vẫn lẹt đẹt và bạn sợ tăng giá sẽ mất khách? Xem ngay video này, mình sẽ chỉ ra ba dấu hiệu giúp các bạn tự tin tăng giá.';
  const est = estimateSpeechDuration(text, 'vi', LANG_WPS);
  assert.ok(est > 7.9 && est < 10.2, `vi estimate ${est}s must bracket the real 9.0s`);
  assert.equal(estimateSpeechDuration('', 'vi', LANG_WPS), 2.5, 'empty text floors at 2.5s');
  assert.equal(estimateSpeechDuration('x '.repeat(4000), 'vi', LANG_WPS), 40, 'ceiling at 40s');
  const en = estimateSpeechDuration('one two three four five six seven eight nine ten', 'en', LANG_WPS);
  assert.ok(en > 4 && en < 6.5, `en 10 words ≈ 4.8–5.2s, got ${en}`);
});

test('estimateWordTiming still spans the given duration (cue seed for pre-TTS beats)', () => {
  const { cues, words } = estimateWordTiming('một hai ba bốn năm sáu bảy tám', 8);
  assert.ok(words.length === 8);
  assert.ok(Math.abs(words[words.length - 1].end - 8) < 0.01, 'last word ends at the duration');
  assert.ok(cues.length >= 1 && cues[0].words.length >= 1);
});

test('templateTimeScale: snap-to-1 band, clamps, and legacy-props passthrough', () => {
  assert.equal(templateTimeScale(undefined, 9), 1, 'legacy spec (no plannedDur) never warps');
  assert.equal(templateTimeScale(0, 9), 1);
  assert.equal(templateTimeScale(9.2, 9), 1, 'within ±4% snaps to 1 (pixel-identical)');
  assert.equal(templateTimeScale(7.5, 9.4), +(7.5 / 9.4).toFixed(4), 'estimate short of real → slow the seek');
  assert.equal(templateTimeScale(30, 9), 2, 'clamped above');
  assert.equal(templateTimeScale(4, 20), 0.5, 'clamped below');
});

test('harness + FX run template layers in authored coordinates, captions on real time', async () => {
  const { buildSceneHtml } = await import('../src/animation/index.js');
  const scene = {
    idx: 0, voice_text: 'Xin chào các bạn', duration: 10, template: 'hyperframe',
    props: { css: '.x{}', html: '<div class="x">hi</div>', script: 'tl.to(".x",{opacity:1,duration:1},0);', plannedDur: 8, guide: null, beats: [] },
    srt_json: [{ start: 0, end: 10, text: 'Xin chào', words: [{ start: 0, end: 10, word: 'Xin' }] }],
  };
  const html = buildSceneHtml(scene, { aspect_ratio: '9:16', title: 't' }, { visualMode: 'hyperframe' }, {});
  assert.match(html, /"tplScale":0\.8/, 'planned 8s over real 10s rides into S');
  // relocated: the single-ratio seek became the piecewise-capable __r2a map (per-word sync)
  assert.match(html, /window\.__r2a = \(t\)/, 'real→authored map defined');
  assert.match(html, /const st = window\.__r2a\(t\)/, '__seek warps template time through the map');
  assert.match(html, /window\.__drawBg\(t\); window\.__drawCaption\(t\); window\.__drawProgress\(t\)/, 'captions/progress stay on real t');
  assert.match(html, /var TSCALE = \(S\.tplScale \|\| 1\);/, 'FX prelude exposes the authored-coordinate scale');
  assert.match(html, /var DUR = \(typeof window!=="undefined" && window\.__authoredDur!=null\) \? window\.__authoredDur/, 'DUR equals the authored span (warp-aware)');
  // a same-duration scene (or legacy props) carries scale 1
  const html2 = buildSceneHtml({ ...scene, props: { ...scene.props, plannedDur: undefined } },
    { aspect_ratio: '9:16', title: 't' }, { visualMode: 'hyperframe' }, {});
  assert.match(html2, /"tplScale":1/, 'legacy spec stays unwarped');
});

test('runner order: visuals precede TTS; estimate seed precedes visuals', () => {
  const s = readFileSync(new URL('../src/pipeline/runner.js', import.meta.url), 'utf8');
  const iSeed = s.indexOf('seedEstimatedTiming(ctx)');
  const iVis = s.indexOf('await runVisuals(ctx)');
  const iTts = s.indexOf('await runTts(ctx)');
  const iRender = s.indexOf('await runRender(ctx)');
  assert.ok(iSeed > 0 && iVis > iSeed && iTts > iVis && iRender > iTts,
    'order must be seed → visuals → (gate) → tts → render');
});

test('review-hardened invariants: warp is hyperframe-only, gate needs unvoiced work, approval is revocable and hold-scoped', async () => {
  // 1. a NON-hyperframe template never inherits a stale plannedDur warp (template-switch case)
  const { buildSceneHtml } = await import('../src/animation/index.js');
  const scene = {
    idx: 0, voice_text: 'Một câu nói hay', duration: 12, template: 'spotlight-quote',
    props: { quote: 'x', plannedDur: 8 }, srt_json: [],
  };
  const html = buildSceneHtml(scene, { aspect_ratio: '9:16', title: 't' }, { visualMode: 'animation' }, {});
  assert.match(html, /"tplScale":1/, 'regular templates rebuild at real duration — no warp');
  // 2. the gate only holds while there is unspent TTS to protect (repurposed projects skip it)
  const runner = readFileSync(new URL('../src/pipeline/runner.js', import.meta.url), 'utf8');
  assert.match(runner, /scenes_approved_at\s*\n?\s*&& DB\.getScenes\(projectId\)\.some\(\(s\) => !s\.audio_path\)/);
  // 3. a regenerated script revokes any prior approval (fresh storyboard = fresh review)
  const script = readFileSync(new URL('../src/pipeline/stages/script.js', import.meta.url), 'utf8');
  assert.match(script, /scenes_approved_at:\s*null/);
  // 4. approve route only accepts a project actually holding at the gate
  const routes = readFileSync(new URL('../src/api/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /status !== 'scenes'\) return res\.status\(409\)/);
  // 5. render-only never concats while any scene is unvoiced (finalize repair would bake
  //    silent estimate-length clips)
  const ro = readFileSync(new URL('../src/pipeline/render-only.js', import.meta.url), 'utf8');
  assert.match(ro, /stillUnvoiced/);
  assert.match(ro, /\['scenes', 'review'\]\.includes\(project\.status\)/, 'holds survive a render-only run');
  // 6. editorial never rewrites text after the timing seed bound visuals to it
  const ed = readFileSync(new URL('../src/pipeline/stages/editorial.js', import.meta.url), 'utf8');
  assert.match(ed, /s\.audio_path \|\| s\.srt_json/);
});
