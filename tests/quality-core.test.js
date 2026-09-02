// Quality core: beat-anchored time warp (per-word AV sync), duration-fit budget gate, and
// the auto-duration verbatim script mode.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beatWarpMap, warpTime, slopeAt } from '../src/animation/timewarp.js';
import { auditBudget, trimToBudget, pickDroppable } from '../src/pipeline/stages/budget.js';
import { LANG_WPS } from '../src/providers/llm.js';

const cues = (words) => [{ start: words[0][1], end: words[words.length - 1][1] + 0.4, text: words.map((w) => w[0]).join(' '),
  words: words.map(([word, start]) => ({ word, start, end: start + 0.3 })) }];

test('beatWarpMap: pins each beat to the real spoken word; endpoints span the durations', () => {
  // authored: 8s estimate, beats at 2.0 ("tăng giá") and 5.0 ("87%")
  const beats = [
    { t0: 2.0, t1: 3.5, text: 'tăng giá', kind: 'keyword' },
    { t0: 5.0, t1: 6.5, text: '87%', kind: 'number' },
  ];
  // real voice: 10s, the same words land at 3.0s and 7.4s
  const real = cues([['Muốn', 0.3], ['tăng', 3.0], ['giá', 3.4], ['phải', 4.2], ['nhớ', 5.0], ['con', 6.4], ['số', 6.9], ['87%', 7.4]]);
  const pts = beatWarpMap(beats, 8, 10, real);
  assert.ok(pts, 'map built');
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[pts.length - 1], [8, 10]);
  // beat 1: authored 2.0 → real 3.0-0.12 lead
  const b1 = pts.find((p) => p[0] === 2);
  assert.ok(b1 && Math.abs(b1[1] - 2.88) < 0.001, `beat 1 pinned to the real word (${JSON.stringify(b1)})`);
  const b2 = pts.find((p) => p[0] === 5);
  assert.ok(b2 && Math.abs(b2[1] - 7.28) < 0.001, 'number beat matched verbatim (captions keep digits)');
  // the in-page inverse: at the real word moment, the authored timeline sits exactly on the beat
  assert.ok(Math.abs(warpTime(2.88, pts) - 2.0) < 0.001, 'seek at real word time hits authored beat time');
  assert.ok(Math.abs(warpTime(7.28, pts) - 5.0) < 0.001);
  assert.equal(warpTime(11, pts), 8, 'past the end holds the authored endpoint');
});

test('beatWarpMap: degrades safely — no srt, no beats, non-monotone anchors, crazy slopes', () => {
  assert.equal(beatWarpMap([], 8, 10, []), null, 'nothing to anchor');
  assert.equal(beatWarpMap([{ t0: 2, t1: 3, text: '', kind: 'phrase' }], 8, 10, cues([['xin', 1]])), null, 'phrase beats carry no text');
  // word appears BEFORE the previous anchor in real time → dropped, not zig-zag
  const beats = [
    { t0: 2, t1: 3, text: 'một', kind: 'keyword' },
    { t0: 5, t1: 6, text: 'hai', kind: 'keyword' },
  ];
  const shuffled = cues([['hai', 1.0], ['một', 6.0]]); // reversed order in real speech
  const pts = beatWarpMap(beats, 8, 10, shuffled);
  if (pts) for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i][0] > pts[i - 1][0] && pts[i][1] > pts[i - 1][1], 'strictly increasing on both axes');
  }
  // a slope beyond [0.4, 2.5] must not survive
  const extreme = beatWarpMap([{ t0: 7.5, t1: 8, text: 'cuối', kind: 'keyword' }], 8, 10, cues([['cuối', 0.5]]));
  assert.equal(extreme, null, 'an anchor demanding a 15x local stretch is rejected (endpoints only → null)');
});

test('pickDroppable: bridge-aware trim keeps the opener + closer, drops a short interior', () => {
  // 3+ sentences → drop the shortest INTERIOR (index 1..n-2), never the first (prev-bridge)
  // nor the last (next-bridge)
  const s = ['Câu mở đầu nối tiếp cảnh trước rất dài dòng.', 'Ngắn.', 'Một câu giữa dài hơn nhiều.', 'Câu kết dẫn sang cảnh sau.'];
  assert.equal(pickDroppable(s), 1, 'shortest interior sentence chosen');
  // 2 sentences → keep the opener (bridges from prev), drop the tail
  assert.equal(pickDroppable(['Vì vậy mình làm bước này.', 'Và đây là kết quả.']), 1);
});

test('slopeAt: local authored-per-real slope drives the entrance floor (F1)', () => {
  // authored 8s over real 4s with a mid anchor: compression varies per segment
  const pts = [[0, 0], [2, 1], [8, 4]]; // seg1 slope 2.0 (authored/real), seg2 slope 2.0
  assert.ok(Math.abs(slopeAt(0.5, pts) - 2.0) < 1e-6, 'compressed segment → slope 2.0');
  assert.ok(Math.abs(slopeAt(3, pts) - 2.0) < 1e-6, 'past the last knot holds the final slope');
  // a non-uniform map: fast start, slow tail
  const pts2 = [[0, 0], [6, 2], [8, 6]]; // seg1 slope 3.0, seg2 slope 0.5
  assert.ok(Math.abs(slopeAt(1, pts2) - 3.0) < 1e-6, 'entrance in the compressed head needs a bigger authored dur');
  assert.ok(Math.abs(slopeAt(4, pts2) - 0.5) < 1e-6, 'the stretched tail plays slower than authored');
  assert.equal(slopeAt(1, null), 1, 'no warp → neutral slope');
});

test('auditBudget + trimToBudget: a 50s script for a 35s order is cut to tolerance at sentence boundaries', () => {
  const wps = LANG_WPS.vi;
  const mk = (n, idx) => ({ id: 's' + idx, idx, voice_text: Array.from({ length: n }, (_, i) => `Câu thứ ${i + 1} có đúng bảy từ nhé bạn.`).join(' ') });
  // 5 scenes × 5 sentences × 8 words = 200 words ≈ 48s narration vs a 35s order
  const scenes = Array.from({ length: 5 }, (_, i) => mk(5, i));
  const opts = { videoDuration: 35, sceneDuration: 7, lang: 'vi', wps };
  const before = auditBudget(scenes, opts);
  assert.ok(before.drift > 0.12, `starts over tolerance (${(before.drift * 100).toFixed(0)}%)`);
  const trims = trimToBudget(scenes, opts);
  assert.ok(trims.size > 0, 'something was trimmed');
  const after = scenes.map((s) => ({ ...s, voice_text: trims.get(s.id) ?? s.voice_text }));
  const audit = auditBudget(after, opts);
  assert.ok(audit.drift <= 0.12 + 0.001, `lands within tolerance (${(audit.drift * 100).toFixed(0)}%)`);
  for (const [, v] of trims) {
    assert.match(v.trim(), /[.!?…]$/, 'trims cut at sentence boundaries only');
    assert.ok(v.trim().length > 0, 'never trims a scene to nothing');
  }
});

test('quota consistency: a fully prompt-compliant script audits INSIDE tolerance', async () => {
  // the review-confirmed bug: quotaWords derived from sceneDuration*wps while estSec divides
  // by wps*0.95 and adds the pad — a perfect script audited 15-21% over and got trimmed.
  const { wordsForSlot } = await import('../src/providers/llm.js');
  const wps = LANG_WPS.vi;
  const quota = wordsForSlot(7, 'vi');
  const word = 'chữ ';
  const scenes = Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, idx: i, voice_text: (word.repeat(quota).trim() + '.') }));
  const a = auditBudget(scenes, { videoDuration: 35, sceneDuration: 7, lang: 'vi', wps });
  assert.ok(Math.abs(a.drift) <= 0.12, `compliant script drift ${(a.drift * 100).toFixed(1)}% must sit inside ±12%`);
  assert.equal(a.quotaWords, quota, 'audit quota equals the prompt budget formula');
});

test('trimToBudget never cuts below one sentence per scene', () => {
  const scenes = [{ id: 'a', idx: 0, voice_text: 'Chỉ có một câu duy nhất ở đây thôi.' }];
  const trims = trimToBudget(scenes, { videoDuration: 1, sceneDuration: 7, lang: 'vi', wps: LANG_WPS.vi });
  assert.equal(trims.size, 0, 'a one-sentence scene is untouchable even when over budget');
});

test('auto-duration verbatim mode: pasted script survives word-for-word, offline', async () => {
  const { generateScript } = await import('../src/providers/llm.js');
  const paste = Array.from({ length: 15 }, (_, i) => `Đây là câu số ${i + 1} trong kịch bản chi tiết mà chủ kênh đã soạn sẵn từ trước.`).join(' ');
  const out = await generateScript({
    topic: paste, inputType: 'text', fetched: null,
    config: { durationMode: 'auto', videoDuration: 15, sceneDuration: 7, language: 'vi' }, ai: null,
  });
  assert.ok(out.scenes.length >= 4, `content-driven scene count (got ${out.scenes.length}), not videoDuration/sceneDuration = 2`);
  const rebuilt = out.scenes.map((s) => s.voice).join(' ').replace(/\s+/g, ' ').trim();
  assert.equal(rebuilt, paste.replace(/\s+/g, ' ').trim(), 'narration is byte-identical to the paste');
  // a SHORT auto-mode topic falls back to target behavior (offline generator)
  const short = await generateScript({
    topic: 'Ba mẹo tiết kiệm', inputType: 'text', fetched: null,
    config: { durationMode: 'auto', videoDuration: 14, sceneDuration: 7, language: 'vi' }, ai: null,
  });
  assert.ok(short.scenes.length >= 1, 'short topic still produces a script');
});

test('logical canvas + lossless zoom: LLM px space is resolution-independent', async () => {
  const { buildSceneHtml } = await import('../src/animation/index.js');
  const scene = { idx: 0, voice_text: 'x', duration: 6, template: 'kinetic-statement', props: { heading: 'X' }, srt_json: [] };
  const project = { aspect_ratio: '16:9', title: 't' };
  // 4K render path: logical 1920x1080 body + zoom 2 + a 2x-backed bg canvas
  const html4k = buildSceneHtml(scene, project, { visualMode: 'hyperframe', resolutionScale: 2 }, { zoom: 2 });
  assert.match(html4k, /width:1920px;height:1080px/, 'body stays in the logical canvas');
  assert.match(html4k, /body\{zoom:2\}/, 'zoom upscales losslessly');
  assert.match(html4k, /"zoom":2/, 'zoom rides into S for the crisp canvas backing store');
  assert.match(html4k, /width="3840" height="2160"/, 'bg canvas backing store is 2x');
  // 1080p path unchanged: no zoom rule, logical == physical
  const html1080 = buildSceneHtml(scene, project, { visualMode: 'hyperframe' }, {});
  assert.ok(!/body\{zoom/.test(html1080), 'scale 1 emits no zoom rule');
  assert.match(html1080, /width="1920" height="1080"/);
  // codegen/validate stay logical regardless of resolutionScale
  const visuals = readFileSync(new URL('../src/pipeline/stages/visuals.js', import.meta.url), 'utf8');
  assert.match(visuals, /animSize\(project\.aspect_ratio, 1\); \/\/ codegen\/validate in the LOGICAL canvas/);
  const prompt = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /upscaled LOSSLESSLY/, 'canvas mandate stated to the model');
  assert.match(prompt, /complete Vietnamese words/, 'no truncated labels rule');
});

test('cinema pacing v3: FX floors, settle state, and the prompt contract', () => {
  const fx = readFileSync(new URL('../src/animation/templates/_shared.js', import.meta.url), 'utf8');
  assert.match(fx, /Math\.max\(Math\.min\(0\.45, hold\*0\.5\), Math\.min\(0\.8, hold\*0\.45\)\)/, 'entrance floor 0.45–0.8s');
  assert.match(fx, /o\.out === 'settle'/, 'persistent settle state exists');
  assert.match(fx, /back\.out\(1\.5\)/, 'pop spring softened');
  const prompt = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /SMOOTH MOTION/, 'smooth-motion contract present');
  assert.match(prompt, /out:'settle'/, 'persistence/settle semantics present');
  assert.match(prompt, /EVEN — THE ZONE BUDGET/, 'balanced-composition rule present (P41: renamed to the zone budget)');
  assert.match(prompt, /premium surfaces/, 'premium-surface bar present');
  assert.match(prompt, /ease in gently/, 'gentle entrance timing stated');
  const warp = readFileSync(new URL('../src/animation/timewarp.js', import.meta.url), 'utf8');
  assert.match(warp, /SLOPE_MIN = 0\.6/, 'gentler warp slope floor');
  assert.match(warp, /SLOPE_MAX = 1\.8/, 'gentler warp slope cap');
  const sample = readFileSync(new URL('../src/styleguide/guide.js', import.meta.url), 'utf8');
  assert.match(sample, /out: 'settle'/, 'worked example models the settle style');
});

test('motion doctrine v4: new FX vocabulary + smooth/sequential/no-breathing prompt contract', () => {
  const fx = readFileSync(new URL('../src/animation/templates/_shared.js', import.meta.url), 'utf8');
  assert.match(fx, /zoomThrough: function/, 'velocity-matched Z-cut exists');
  assert.match(fx, /jitter: function/, 'sanctioned-aliveness jitter exists');
  assert.match(fx, /targetZoom: function/, 'counter-translated target zoom exists');
  assert.match(fx, /dofBlur: function/, 'rack-focus blur exists');
  assert.match(fx, /iconSpin: function/, 'svgOrigin icon spin exists');
  assert.match(fx, /profile === 'front'/, 'camPush front-half profile exists');
  assert.match(fx, /ease:o\.ease\|\|'back\.out\(1\.5\)'/, 'beat pop ease is overridable (smooth by prompt, compat by default)');
  const prompt = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /playful accent/, 'bounce-restraint ease doctrine stated');
  assert.match(prompt, /one main thing arriving at a time/i, 'sequential-reveal rule stated');
  assert.match(prompt, /TECHNICAL RULES/, 'technical must-not-break block present');
  assert.match(prompt, /profile:'front'/, 'camera front-profile mandated');
  assert.match(prompt, /FX\.zoomThrough/, 'seam-cut vocabulary taught');
  const sample = readFileSync(new URL('../src/styleguide/guide.js', import.meta.url), 'utf8');
  assert.match(sample, /profile: 'front'/, 'worked example uses the front camera profile');
  assert.match(sample, /FX\.jitter/, 'worked example models jitter aliveness');
});

test('font-swap flash fix: every face force-loaded before the timeline builds, no font-display swap', () => {
  // fonts.ready only waits for loads already TRIGGERED — 23/32 faces stayed unloaded and
  // could swap in mid-video (measured in Chrome). __init must force-load all of them.
  const h = readFileSync(new URL('../src/animation/harness.js', import.meta.url), 'utf8');
  assert.match(h, /document\.fonts\.forEach\(\(f\) => \{ try \{ loads\.push\(f\.load\(\)\); \}/, 'force-load of every declared face');
  assert.ok(h.indexOf('Promise.allSettled(loads)') < h.indexOf('window.__fitText()'), 'faces load BEFORE fitText/SplitText measure');
  // vendor/ is gitignored (fonts are built locally) — assert only when present
  try {
    const css = readFileSync(new URL('../vendor/fonts/fonts.css', import.meta.url), 'utf8');
    assert.ok(!/font-display:\s*swap/.test(css), 'vendored fonts.css never paints fallback (block, not swap)');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const gen = readFileSync(new URL('../scripts/build-fonts.mjs', import.meta.url), 'utf8');
  assert.match(gen, /font-display: block/, 'the generator keeps emitting block on rebuilds');
});

test('template premium infrastructure: auto backdrop, beat pulses, FX.impact', () => {
  const hf = readFileSync(new URL('../src/animation/templates/hyperframe.js', import.meta.url), 'utf8');
  assert.match(hf, /function decoLayer/, 'auto set-dressing layer exists');
  assert.match(hf, /hf-dpulse/, 'beat pulse element present');
  assert.match(hf, /__hfBeats/, 'pulses wired to narration beats');
  assert.match(hf, /hfsheen/, 'underline auto-sheen present');
  const fx = readFileSync(new URL('../src/animation/templates/_shared.js', import.meta.url), 'utf8');
  assert.match(fx, /impact: function/, 'FX.impact primitive exists');
  const prompt = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /THE STAGE/, 'model told the stage/backdrop already exists');
  assert.match(prompt, /FX\.impact/, 'impact mandated in the prompt');
  const sample = readFileSync(new URL('../src/styleguide/guide.js', import.meta.url), 'utf8');
  assert.match(sample, /FX\.impact/, 'worked example models the impact accent');
});

test('blueprint layouts + narrative roles wired into the direction pass', () => {
  const d = readFileSync(new URL('../src/pipeline/direction.js', import.meta.url), 'utf8');
  for (const l of ['kinetic-type-beats', 'ticker-takeover', 'overwhelm-surround', 'pan-stations', 'titlecard-reveal']) {
    assert.ok(d.includes(`'${l}'`), `layout ${l} present`);
  }
  assert.match(d, /ROLE → LAYOUT menu/, 'role→layout menu present');
  assert.match(d, /\[CHOREOGRAPHY\]/, 'per-element motion verbs demanded');
  assert.match(d, /at least ONE titlecard-reveal/, 'breather rule present');
  assert.match(d, /\[ROLE\] \$\{role\}/, 'role rides at the top of the brief');
  const p = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(p, /\[MAIN FOCUS\]/, 'codegen reads the structured visual brief');
});

test('prompt v2 + budget stage source anchors (P4/P5 intact, gate wired pre-seed)', () => {
  const llm = readFileSync(new URL('../src/providers/llm.js', import.meta.url), 'utf8');
  assert.match(llm, /Math\.ceil\(sceneCount\s*\*\s*0\.7\)/, 'P4 anchor survives prompt v2');
  assert.match(llm, /Math\.ceil\(perCh\s*\*\s*0\.6\)/, 'P4 chapter anchor survives');
  assert.equal(LANG_WPS.vi, 4.4, 'P5 anchor survives');
  assert.match(llm, /DURATION SHAPE/, 'duration shape block present (content-led range, not EXACTLY-N)');
  assert.match(llm, /VALUE ARCHITECTURE/, 'value-first doctrine present (replaces the old micro-hook mandate)');
  assert.match(llm, /At most ONE genuine viewer-directed question/, 'filler-question cap present');
  assert.doesNotMatch(llm, /LAST sentence of each scene is a MICRO-HOOK/, 'the per-scene micro-hook mandate is gone');
  // coherence: plan-then-write through-line + positive forward-linkage (replaces the removed bridge)
  assert.match(llm, /PLAN THEN WRITE/, 'plan-then-write ordering present');
  assert.match(llm, /"throughline"/, 'through-line field emitted before scenes (field-order forcing)');
  assert.match(llm, /each scene CONTINUES the previous one/, 'positive scene-to-scene linkage rule present');
  assert.match(llm, /scriptBudgetOk\(p\.scenes, wordsPerScene, language\)/, 'gross-overrun re-ask wired into validate');
  assert.match(llm, /export function wordsForSlot/, 'canonical per-scene budget formula exported');
  const runner = readFileSync(new URL('../src/pipeline/runner.js', import.meta.url), 'utf8');
  const iBudget = runner.indexOf('runBudgetFit(ctx)');
  const iSeed = runner.indexOf('seedEstimatedTiming(ctx)');
  assert.ok(iBudget > 0 && iSeed > iBudget, 'budget fit runs BEFORE the timing seed');
  const budget = readFileSync(new URL('../src/pipeline/stages/budget.js', import.meta.url), 'utf8');
  assert.match(budget, /durationMode === 'auto'\) return/, 'auto mode is never trimmed');
  assert.match(budget, /input_type === 'json'\) return/, 'pasted JSON is never trimmed');
});

// Output resolution rungs: 1080p · 2K · 4K. Every ratio must stay integer AND even — h.264
// refuses odd dimensions, and a fractional viewport silently truncates in the renderer.
test('resolution rungs land on exact even frames at every aspect ratio', async () => {
  const { animSize, resRung } = await import('../src/animation/index.js');
  assert.equal(resRung(1.3333).toFixed(4), (4 / 3).toFixed(4), '1.3333 snaps to the 2K rung');
  assert.equal(resRung(undefined), 1, 'a missing scale is 1080p, never NaN');
  assert.equal(resRung(9), 2, 'anything above the top rung clamps to 4K');
  assert.deepEqual(animSize('16:9', 1.3333), { w: 2560, h: 1440 }, '16:9 2K is exactly QHD');
  assert.deepEqual(animSize('9:16', 1.3333), { w: 1440, h: 2560 });
  assert.deepEqual(animSize('16:9', 2), { w: 3840, h: 2160 }, '4K unchanged');
  for (const ar of ['16:9', '9:16', '1:1', '4:5']) {
    for (const s of [1, 1.3333, 2]) {
      const { w, h } = animSize(ar, s);
      assert.ok(Number.isInteger(w) && Number.isInteger(h), `${ar}@${s} is integer`);
      assert.ok(w % 2 === 0 && h % 2 === 0, `${ar}@${s} is even`);
    }
  }
  const ui = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(ui, /id="cfgRes"[\s\S]*?value="1\.3333">2K</, 'the 2K rung is reachable from the UI');
});

test('a scene clip that came out the wrong size fails loudly', () => {
  // A long-running server holding older code rendered a 2K project at 1080p and said nothing:
  // the clips joined, the file shipped, and only ffprobe knew. Same doctrine as the font check.
  const src = readFileSync(new URL('../src/animation/index.js', import.meta.url), 'utf8');
  assert.match(src, /const got = await probeImageSize\(res\.path\);/);
  assert.match(src, /got\.w !== w \|\| got\.h !== h/);
  assert.match(src, /kích thước không khớp/);
});
