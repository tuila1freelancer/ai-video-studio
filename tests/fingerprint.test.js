// Content-hash resume invariants: stable across key order, sensitive to real input edits,
// blind to credentials and to preview outputs.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ttsFingerprint, renderFingerprint, renderFingerprintLegacy, renderCurrent, fpCurrent } from '../src/pipeline/fingerprint.js';

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

test('subtitleLane never moves the digest of an existing project', () => {
  const proj = { project: { aspect_ratio: '16:9' } };
  const fp = (config) => renderFingerprint(frozenScene, { ...proj, config });

  // 'scene' is the default, so writing it out explicitly must be a NO-OP. This is the trap the
  // key name sets: `subtitleLane` starts with "sub", so RENDER_CFG_KEYS picks it up for free and
  // the first project to save the panel would re-render every clip it owns for a setting that
  // changed nothing. It has to be stripped from the sweep and read only as a mode.
  assert.equal(fp({ subtitleLane: 'scene' }), FROZEN.renderNoLanguage);
  assert.equal(fp({ ...SUB_CFG, subtitleLane: 'scene' }), FROZEN.renderWithSubtitles);

  // 'final' DOES move it, and that is correct: clips with captions baked in have to be rendered
  // once without them. Captions stop being an input, so the digest collapses onto the
  // no-subtitles one.
  assert.equal(fp({ ...SUB_CFG, subtitleLane: 'final' }), FROZEN.renderNoLanguage);
  assert.notEqual(fp({ ...SUB_CFG, subtitleLane: 'final' }), FROZEN.renderWithSubtitles);

  // …which is the whole point: on the final lane a subtitle edit cannot make a clip stale
  assert.equal(
    fp({ ...SUB_CFG, subtitleLane: 'final' }),
    fp({ ...SUB_CFG, subtitleFont: 'Bebas Neue', subtitleColor: '#FF0000', subtitleFontSize: 96, subtitleLane: 'final' }),
  );
  // but a NON-subtitle setting still does
  assert.notEqual(
    fp({ ...SUB_CFG, subtitleLane: 'final' }),
    fp({ ...SUB_CFG, subtitleLane: 'final', styleId: 'other-style' }),
  );
});

test('switching the logo stamp off does not invalidate a single clip', () => {
  // The stamp and the drifting watermark are applied by concatScenes, to the assembled
  // programme, long after every clip is finished — but they were hashed into the RENDER digest,
  // so turning the logo off cost 105 scene re-renders to change one overlay filter.
  const proj = { project: { aspect_ratio: '16:9' } };
  const fp = (config) => renderFingerprint(frozenScene, { ...proj, config });
  const bk = (finalOverlay, watermark) => ({
    brandKit: { logo: { assetPath: '/logo.png' }, channelName: 'X', finalOverlay, watermark },
  });
  assert.equal(fp(bk({ enabled: true, wPct: 0.075 })), fp(bk({ enabled: false })));
  assert.equal(fp(bk({ enabled: true }, { enabled: true })), fp(bk({ enabled: true }, { enabled: false })));
  // …while the parts of the brand kit that DO reach a scene page still count
  assert.notEqual(fp(bk({ enabled: true })), fp({ brandKit: { logo: { assetPath: '/other.png' }, channelName: 'X' } }));
});

test('a clip stamped under the older digest definition is kept, not re-rendered', () => {
  // Removing a key from a hash invalidates everything stamped with the old one. Usually that is
  // the correct answer; here it is pure waste — the clips are pixel-identical and only our idea
  // of which inputs matter has changed. Measured before making the change: 11 of 44 projects
  // carry brandKit.finalOverlay or brandKit.watermark.
  const ctx = { project: { aspect_ratio: '16:9' }, config: { brandKit: { logo: { assetPath: '/l.png' }, finalOverlay: { enabled: true, wPct: 0.08 } } } };
  const old = renderFingerprintLegacy(frozenScene, ctx);
  const want = renderFingerprint(frozenScene, ctx);
  assert.notEqual(old, want, 'the definition really did move for this config');

  const stamped = { ...frozenScene, fp: { render: old } };
  const r = renderCurrent(stamped, ctx);
  assert.equal(r.ok, true, 'the clip is current');
  assert.equal(r.migrate, true, 'and asks to be re-stamped so the shim is needed once');
  assert.equal(r.want, want);

  // a genuinely stale clip is still stale
  assert.equal(renderCurrent({ ...frozenScene, fp: { render: 'something else' } }, ctx).ok, false);
  // and an unstamped legacy row keeps being trusted, exactly as before
  assert.equal(renderCurrent(frozenScene, ctx).ok, true);
  assert.equal(renderCurrent(frozenScene, ctx).migrate, false);
});

test('fpCurrent trusts legacy rows (null fp) and enforces stamped ones', () => {
  const want = ttsFingerprint(scene, ctx);
  assert.equal(fpCurrent(scene, 'tts', want), true, 'legacy artifact stays trusted');
  assert.equal(fpCurrent({ ...scene, fp: { tts: want } }, 'tts', want), true);
  assert.equal(fpCurrent({ ...scene, fp: { tts: 'stale' } }, 'tts', want), false);
});
