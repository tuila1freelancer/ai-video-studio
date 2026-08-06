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

// FROZEN HASHES — the single highest-value assertion in this file.
//
// `ttsFingerprint` hashes `lang: config.language || 'auto'`. Measured on the live DB: 808 already
// VOICED scenes carry a stamped fp.tts inside projects whose config.language is unset. Any change
// that moves this hash — adding a key, removing the lang key, backfilling config.language onto old
// projects — makes the next resume re-synthesize all of them at ~108k paid characters. That bill
// must arrive as a red test, not as an invoice. If you are here because this test failed: you did
// not "break a test", you were about to re-buy 808 voice-overs. Re-read the language plan.
const FROZEN = {
  ttsNoLanguage: 'f0db042a2d5503b5',   // config: {}
  ttsLangVi: '57804e5af1b0d86f',       // config: { language: 'vi' }
  renderNoLanguage: '218a91492bc8fc00',
  // Captured 2026-08-06, BEFORE the final-pass subtitle lane existed. Every rendered clip on
  // disk was stamped with a digest from this exact key set. See the subtitleLane test below.
  renderWithSubtitles: 'fa8a58618d217dd6',
  renderBrandOnly: '9bd61cb13ab913d1',
};
// The subtitle config a real project carries — every key here is inside RENDER_CFG_KEYS today.
const SUB_CFG = {
  enableSubtitles: true, subtitleFont: 'Anton', subtitleFontSize: 80,
  subtitlePreset: 'bold-impact', subtitlePosition: { preset: 'bot', marginV: 0.12 },
};
const frozenScene = { voice_text: 'Xin chào các bạn', template: 'hyperframe', props: { a: 1 } };

test('the tts fingerprint has not moved — 808 paid scenes depend on it', () => {
  const bare = { config: {}, channel: null, ai: {} };
  assert.equal(ttsFingerprint(frozenScene, bare), FROZEN.ttsNoLanguage);
  assert.equal(ttsFingerprint(frozenScene, { ...bare, config: { language: 'vi' } }), FROZEN.ttsLangVi);
  // and the two really are different — which is exactly why backfilling is forbidden
  assert.notEqual(FROZEN.ttsNoLanguage, FROZEN.ttsLangVi);
});

test('language is deliberately NOT part of the render fingerprint', () => {
  // the clip is built from scene.props (the on-screen words are already baked in) and srt_json;
  // language only INFLUENCED those upstream. Including it would re-render every clip on every
  // resume for a field the renderer never reads. RENDER_CFG_KEYS must not learn about language.
  const proj = { project: { aspect_ratio: '16:9' } };
  assert.equal(renderFingerprint(frozenScene, { ...proj, config: {} }), FROZEN.renderNoLanguage);
  assert.equal(renderFingerprint(frozenScene, { ...proj, config: { language: 'en' } }), FROZEN.renderNoLanguage);
  assert.equal(renderFingerprint(frozenScene, { ...proj, config: { language: 'vi' } }), FROZEN.renderNoLanguage);
});

test('the render digest of a real subtitle config has not moved either', () => {
  // Every clip on disk was stamped with a digest built from the CURRENT RENDER_CFG_KEYS set.
  // The final-pass subtitle lane is about to take the `sub*` keys out of that set for projects
  // that opt in; removing a key from a digest is the same class of accident as adding one. This
  // pins what the untouched (opt-out) path must keep producing.
  const proj = { project: { aspect_ratio: '16:9' } };
  const fp = (config) => renderFingerprint(frozenScene, { ...proj, config });
  assert.equal(fp(SUB_CFG), FROZEN.renderWithSubtitles);
  assert.equal(fp({ brandKit: { logo: '/x.png' }, styleId: 'chrome-kinetic' }), FROZEN.renderBrandOnly);
  // subtitle settings really are inputs to the clip today — that is exactly what the new lane
  // changes, and why the change has to be gated behind an explicit opt-in
  assert.notEqual(fp(SUB_CFG), fp({ ...SUB_CFG, subtitleFont: 'Lexend' }));
});

test('fpCurrent trusts legacy rows (null fp) and enforces stamped ones', () => {
  const want = ttsFingerprint(scene, ctx);
  assert.equal(fpCurrent(scene, 'tts', want), true, 'legacy artifact stays trusted');
  assert.equal(fpCurrent({ ...scene, fp: { tts: want } }, 'tts', want), true);
  assert.equal(fpCurrent({ ...scene, fp: { tts: 'stale' } }, 'tts', want), false);
});
