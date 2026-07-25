// P35 — visual quality levers: role-aware per-scene density (with validation floors that
// scale to match), a positive dialogue-match gate, an art director who sees the spoken
// anchors, a duration-scaled beat budget, honest contrast for headline text, regen parity
// with the no-fallback contract, and WHITE-frame QC (the reference app's blank-scene bug).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { densityForScene, buildCodegenPrompt } from '../src/hyperframe/prompt.js';
import { extractBeats } from '../src/hyperframe/beats.js';
import { resolveGuide } from '../src/styleguide/index.js';
import { PATHS } from '../src/config/paths.js';

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('P35 densityForScene: hook/proof/payoff → rich, cta → minimal, else the project baseline', () => {
  assert.equal(densityForScene({ visual_prompt: '[ROLE] hook\n[MAIN FOCUS] x' }, 'balanced'), 'rich');
  assert.equal(densityForScene({ visual_prompt: '[ROLE] proof …' }, 'minimal'), 'rich');
  assert.equal(densityForScene({ visual_prompt: '[ROLE] payoff …' }, undefined), 'rich');
  assert.equal(densityForScene({ visual_prompt: '[ROLE] cta …' }, 'rich'), 'minimal');
  assert.equal(densityForScene({ visual_prompt: '[ROLE] step …' }, 'rich'), 'rich');
  assert.equal(densityForScene({ visual_prompt: '[MAIN FOCUS] no role marker' }, 'minimal'), 'minimal');
  assert.equal(densityForScene({}, undefined), 'balanced');
});

test('P35 beat budget scales UP with duration; short scenes keep the historic cap', () => {
  // realistic word stream: every 6th word is a bare number — the strongest beat hooks
  const cues = (n, dur) => [{ start: 0, end: dur, text: 'x',
    words: Array.from({ length: n }, (_, i) => ({ start: (i * dur) / n, end: ((i + 1) * dur) / n, word: i % 6 === 0 ? String(10 + i) : `chữ${i}` })) }];
  const b6 = extractBeats(cues(30, 6), [], 6);
  assert.ok(b6.length <= 5, `6s scene stays within the historic cap (${b6.length})`);
  const b25 = extractBeats(cues(120, 25), [], 25);
  assert.ok(b25.length > 5, `a 25s scene may exceed the old cap of 5 (${b25.length})`);
  assert.ok(b25.length <= 10, 'hard ceiling 10');
  assert.ok(extractBeats(cues(120, 25), [], 25, { max: 4 }).length <= 4, 'explicit max always wins');
});

test('P35 preset effects/ambient reach the codegen prompt (the wired-but-empty blocks now fire)', () => {
  const guide = resolveGuide({ hyperframe: { styleId: 'tuila1-hud-cyber' } });
  assert.ok(guide.effects?.length >= 3, 'preset carries named text treatments');
  assert.ok(guide.ambient?.length >= 2, 'preset carries ambient notes');
  const [, usr] = buildCodegenPrompt({
    scene: { voice_text: 'x' }, beats: [], direction: {}, guide,
    w: 540, h: 960, duration: 6, idx: 1, total: 10, density: 'balanced',
  });
  assert.match(usr.content, /TEXT EFFECT PRESETS/);
  assert.match(usr.content, /Chrome-Impact/);
  assert.match(usr.content, /AMBIENT NOTES/);
});

test('P38 source pins: the render gate is not-broken + balanced only (caliber/soft/contrast gone)', () => {
  const v = src('../src/hyperframe/validate.js');
  assert.match(v, /stacked on the center axis/, 'P38 distribution (center-clump) check exists');
  assert.match(v, /hadCluster && maxSpread < 0\.22/, 'the distribution check measures horizontal spread');
  assert.ok(!/softDefects/.test(v), 'the soft caliber gates are removed');
  assert.ok(!/contrastFix/.test(v), 'the auto-contrast repair target is removed from validate');
  assert.ok(!/the spoken anchor words|hero construction carries only|produce no visual response|the scene reads sparse/.test(v), 'the caliber nudges are gone');
  const c = src('../src/hyperframe/codegen.js');
  assert.ok(!/captionsOn, overlay, density/.test(c), 'renderValidate no longer receives density');
  assert.ok(!/softDefects|contrastRepaired|const tier =/.test(c), 'codegen drops the contrast-repair + tier logic');
});

test('P35 source pins: regen parity + no-fallback; director sees spoken anchors', () => {
  const r = src('../src/pipeline/regen.js');
  assert.match(r, /diversitySalt: hash32\(String\(project\.id\)\)/, 'regen salts like the batch lane');
  assert.ok(!/qtier:/.test(r), 'P38: regen no longer persists a quality tier');
  assert.match(r, /captionsOn: config\.enableSubtitles !== false/, 'caption reserve parity');
  assert.match(r, /delete baseLlm\.modelFallback/, 'no-fallback model contract in regen');
  assert.ok(!/catch \{\s*\n?\s*plan = planScene/.test(r), 'the silent heuristic fallback for hyperframe regen is gone');
  const d = src('../src/pipeline/direction.js');
  assert.match(d, /spoken anchors/, 'briefs carry the beat labels + times');
  assert.match(d, /Anchor the \[CHOREOGRAPHY\] verbs/, 'anchoring rule in the director prompt');
});

const haveFfmpeg = !!PATHS.ffmpeg && !!PATHS.ffprobe;
test('P38 QC trim: qcFinalVideo no longer pixel-scans — a white clip passes integrity', { skip: !haveFfmpeg }, async () => {
  const { ffmpeg } = await import('../src/media/ffmpeg.js');
  const { qcFinalVideo } = await import('../src/pipeline/qc.js');
  const dir = mkdtempSync(join(tmpdir(), 'avs-white-'));
  const mk = async (name, color) => {
    const out = join(dir, name);
    await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=3`, '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
      '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', out]);
    return out;
  };
  // P38 dropped the black/white pixel scan; codegen-time renderValidate + the harness-owned dark
  // backdrop prevent blank scenes at the source, so the final gate is stream/duration integrity only.
  const white = await qcFinalVideo(await mk('white.mp4', 'white'), { expectDur: 3 });
  assert.equal(white.ok, true, 'the white-frame pixel scan is removed; integrity (streams + duration) passes');
  assert.ok(!white.issues.some((i) => i.type === 'white' || i.type === 'black'), 'no pixel-based issue types remain');
});
