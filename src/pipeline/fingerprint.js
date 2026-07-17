// Per-scene input fingerprints — the difference between "artifact exists" and "artifact is
// still CURRENT". Each stage stamps a content hash of its inputs next to the artifact
// (scenes.fp JSON: {tts, img, render}); on resume the stage re-runs when the hash moved.
//
// Policy (conservative superset, per the upgrade plan):
//   - NULL fp (legacy rows, pre-upgrade projects) → TRUST the artifact: exactly the old
//     existence-based behavior, so upgrading never triggers a mass re-synthesis.
//   - Identity-relevant inputs only: credentials/baseUrls are excluded so rotating an API
//     key never re-synthesizes a video.
//   - A voice edit re-runs TTS + re-renders THAT scene's clip, but deliberately does NOT
//     invalidate a hyperframe spec (LLM codegen fan-out needs an explicit regen action).
import { createHash } from 'node:crypto';
import { ttsOverrideFor } from '../core/config.js';

// Canonical JSON: object keys sorted recursively so hashes are insertion-order independent.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
const digest = (o) => createHash('sha1').update(stable(o)).digest('hex').slice(0, 16);

/** Inputs that shape a scene's VOICE artifact (audio + srt_json). */
export function ttsFingerprint(scene, { config, channel, ai }) {
  const o = ttsOverrideFor(channel, config) || {};
  const t = ai?.tts || {};
  return digest({
    v: String(scene.voice_text || '').trim(),
    ov: { p: o.provider || null, vo: o.voice || null },
    id: { p: t.provider || null, lv: t.langVoices || null, ev: t.edgeVoice || null, vo: t.voice || null, vid: t.voiceId || null, rate: t.rate || null, speed: t.speed || null },
    lex: o.lexicon || t.lexicon || null, // pronunciation lexicon changes what is SPOKEN
    lang: config.language || 'auto',
    eng: ai?.subtitle?.engine || 'estimate',
  });
}

// Config keys that shape a rendered CLIP (visual identity + captions + branding).
// Duration is deliberately excluded: the A/V-mismatch verify (P6) owns timing drift, and a
// QC-repaired clip must not read as stale on the next resume.
const RENDER_CFG_KEYS = /^(sub|brandKit|hyperframe|styleId|richAnimation|renderMode|visualMode|resolutionScale|logo|watermark|overlay)/;

/** Inputs that shape a scene's rendered clip (video_path). */
export function renderFingerprint(scene, { config, project }) {
  const cfg = {};
  for (const [k, v] of Object.entries(config || {})) if (RENDER_CFG_KEYS.test(k)) cfg[k] = v;
  // image_path is an INPUT only in image mode (the Ken-Burns background); in animation/
  // hyperframe it is a preview OUTPUT of the render — including it there would make every
  // resume read the clip as stale.
  const imageMode = (config?.visualMode || 'animation') === 'image';
  return digest({
    tpl: scene.template || null,
    props: scene.props || null,
    img: imageMode && scene.image_path ? String(scene.image_path).split('/').pop() : null,
    ar: project?.aspect_ratio || null,
    cfg,
  });
}

/** Inputs that shape an image-mode scene background (image_path). */
export function imageFingerprint(scene, { config, ai, size }) {
  return digest({
    vp: String(scene.visual_prompt || '').trim(),
    style: config.styleId || null,
    consistent: !!config.consistentScenes,
    rich: config.richAnimation !== false,
    prov: { p: ai?.imageGen?.provider || null, m: ai?.imageGen?.model || null },
    w: size?.w, h: size?.h,
  });
}

/**
 * Resume predicate helper: keep the artifact when the stamp is absent (legacy) or matches.
 * @returns {boolean} true = artifact is current, skip the stage for this scene
 */
export function fpCurrent(scene, key, expected) {
  const got = scene.fp?.[key];
  return !got || got === expected;
}

/** Merge one fingerprint key into the scene's fp JSON (returns the merged object). */
export function fpStamp(scene, key, value) {
  return { ...(scene.fp || {}), [key]: value };
}
