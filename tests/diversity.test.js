// P31 — every video unique, reference-app parity.
// (a) No synthetic intro/outro cards: the program is the script's scenes only — the ending
//     is the script's own closing-CTA scene, codegen'd like any scene (reference sessions
//     hold exactly one HTML per scripted scene, none extra).
// (b) Per-project diversity: scene N of two different videos must not share randomness —
//     sceneSeed salts the seed with the project id and motionSignature rotates with a
//     per-project salt. No project id → legacy values, byte-identical.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hash32 } from '../src/util/util.js';
import { sceneSeed, buildSceneHtml } from '../src/animation/index.js';
import { motionSignature } from '../src/hyperframe/signatures.js';

test('P31 hash32: stable, 32-bit, distinct across ids', () => {
  assert.equal(hash32('proj_a'), hash32('proj_a'));
  assert.notEqual(hash32('proj_a'), hash32('proj_b'));
  assert.equal(hash32(''), 0x811c9dc5 >>> 0, 'FNV offset basis for the empty string');
});

test('P31 sceneSeed: project-salted, deterministic per project, legacy without an id', () => {
  assert.equal(sceneSeed({ }, 0), 1, 'no id → legacy idx+1');
  assert.equal(sceneSeed(null, 4), 5);
  const a = sceneSeed({ id: 'proj_a' }, 2), a2 = sceneSeed({ id: 'proj_a' }, 2);
  const b = sceneSeed({ id: 'proj_b' }, 2);
  assert.equal(a, a2, 'same project + idx → same seed forever (resume/re-render stable)');
  assert.notEqual(a, b, 'same idx, different videos → different randomness');
  assert.notEqual(sceneSeed({ id: 'proj_a' }, 2), sceneSeed({ id: 'proj_a' }, 3), 'idx still varies within a video');
});

test('P31 motionSignature: salt rotates the modulo picks, roles stay role-driven', () => {
  const steady = { energy: 'steady' };
  const s0 = motionSignature(steady, 0, 0), s1 = motionSignature(steady, 0, 1);
  assert.notEqual(s0.id || s0.name || JSON.stringify(s0), s1.id || s1.name || JSON.stringify(s1),
    'same scene index, different salt → different signature');
  assert.equal(motionSignature(steady, 0, 0), motionSignature(steady, 4, 0), 'legacy rotation period intact');
  const hook = motionSignature({ isHook: true }, 0, 12345);
  assert.equal(hook, motionSignature({ isHook: true }, 0, 0), 'hook stays maximalist under any salt');
});

test('P31 page seed: two projects render the same scene with different seeds; no id stays legacy', () => {
  const scene = { idx: 0, voice_text: 'x', duration: 6, template: 'kinetic-statement', props: { heading: 'X' }, srt_json: [] };
  const cfg = { visualMode: 'hyperframe' };
  const htmlA = buildSceneHtml(scene, { id: 'proj_a', aspect_ratio: '16:9', title: 't' }, cfg, {});
  const htmlB = buildSceneHtml(scene, { id: 'proj_b', aspect_ratio: '16:9', title: 't' }, cfg, {});
  const seedOf = (h) => h.match(/"seed":(\d+)/)[1];
  assert.notEqual(seedOf(htmlA), seedOf(htmlB), 'per-project ambience/particles diverge');
  const legacy = buildSceneHtml(scene, { aspect_ratio: '16:9', title: 't' }, cfg, {});
  assert.equal(seedOf(legacy), '1', 'no project id → the historic seed, byte-identical pages');
});

test('P31 no synthetic cards: finalize concats the scenes and nothing else', () => {
  const src = readFileSync(new URL('../src/pipeline/stages/finalize.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('renderOutroScene'), 'outro clip lane removed');
  assert.ok(!src.includes('renderCard'), 'intro/outro card lane removed');
  assert.ok(!/Cảm ơn đã xem/.test(src), 'no hardcoded farewell text anywhere in finalize');
  assert.match(src, /nIntro: 0, nOutro: 0/, 'transition plan indexes scenes directly');
});
