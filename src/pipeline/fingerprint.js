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

/**
 * `subtitleLane` decides WHERE captions are drawn, and it is the one config key that must never
 * reach the digest as itself.
 *
 * It starts with "sub", so RENDER_CFG_KEYS picks it up for free — and the first project to save
 * the default explicitly would invalidate every clip it owns for a setting that changed nothing.
 * It is stripped, and read only as a mode:
 *
 *   'scene' / absent → captions are drawn inside each clip, so every `sub*` key is an input
 *   'final'          → captions are burned at concat, so no `sub*` key is an input at all
 *
 * The second case collapses a subtitled project's digest onto the unsubtitled one, which is
 * exactly the intent: on the final lane, editing the font or the colour or the position cannot
 * make a single clip stale. Switching a finished project ONTO the lane does move the digest, and
 * that re-render is real work — captions already baked into 95 clips cannot be un-baked.
 */
const LANE_KEY = 'subtitleLane';
const SUB_KEY = /^sub/;

/** Inputs that shape a scene's rendered clip (video_path). */
export function renderFingerprint(scene, { config, project }) {
  const cfg = {};
  const finalLane = (config || {})[LANE_KEY] === 'final';
  for (const [k, v] of Object.entries(config || {})) {
    if (k === LANE_KEY) continue;
    if (!RENDER_CFG_KEYS.test(k)) continue;
    if (finalLane && SUB_KEY.test(k)) continue;
    cfg[k] = v;
  }
  return digest({
    tpl: scene.template || null,
    props: scene.props || null,
    // scene.image_path is a preview OUTPUT of the GSAP render (never a render INPUT), so it is
    // deliberately excluded — including it would make every resume read the clip as stale.
    // (It WAS an input for the removed image visual mode's Ken-Burns background.)
    img: null,
    ar: project?.aspect_ratio || null,
    cfg,
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
