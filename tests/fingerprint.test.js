// Content-hash resume invariants: stable across key order, sensitive to real input edits,
// blind to credentials and to preview outputs.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ttsFingerprint, renderFingerprint, fpCurrent } from '../src/pipeline/fingerprint.js';

const scene = { voice_text: 'Xin chào các bạn', template: 'kinetic-statement', props: { a: 1, b: 2 }, fp: null };
const ctx = {
  config: { language: 'vi', visualMode: 'hyperframe' },
  channel: null,
  ai: { tts: { provider: 'edge', edgeVoice: 'auto' }, subtitle: { engine: 'estimate' } },
  project: { aspect_ratio: '9:16' },
};

test('fingerprints are stable across object key order', () => {
  const t1 = ttsFingerprint(scene, ctx);
  const t2 = ttsFingerprint({ ...scene }, { ...ctx, ai: { ...ctx.ai, tts: { edgeVoice: 'auto', provider: 'edge' } } });
  assert.equal(t1, t2);
  assert.equal(renderFingerprint(scene, ctx), renderFingerprint({ ...scene, props: { b: 2, a: 1 } }, ctx));
});

test('a voice edit moves the tts fingerprint; an api-key rotation does not', () => {
  const base = ttsFingerprint(scene, ctx);
  assert.notEqual(base, ttsFingerprint({ ...scene, voice_text: 'Lời khác' }, ctx));
  assert.equal(base, ttsFingerprint(scene, { ...ctx, ai: { ...ctx.ai, tts: { ...ctx.ai.tts, apiKey: 'ROTATED' } } }));
});

test('render fingerprint ignores preview images but tracks props edits', () => {
  const base = renderFingerprint(scene, ctx);
  assert.equal(base, renderFingerprint({ ...scene, image_path: '/x/scene_001_preview.jpg' }, ctx));
  assert.notEqual(base, renderFingerprint({ ...scene, props: { a: 1, b: 3 } }, ctx));
});

test('fpCurrent trusts legacy rows (null fp) and enforces stamped ones', () => {
  const want = ttsFingerprint(scene, ctx);
  assert.equal(fpCurrent(scene, 'tts', want), true, 'legacy artifact stays trusted');
  assert.equal(fpCurrent({ ...scene, fp: { tts: want } }, 'tts', want), true);
  assert.equal(fpCurrent({ ...scene, fp: { tts: 'stale' } }, 'tts', want), false);
});
