// Single source of truth for config layering and per-channel AI settings.
//
// Output-config precedence (later wins):
//   code-level defaults (stay at consumption sites) → channel.config → channel default preset → request
// AI-settings precedence:
//   DEFAULT_SETTINGS → global settings['ai'] → channel.config.ai   (merged per section)
//
// Secrets never leave the server unmasked: maskSecrets() on every egress,
// applyMaskedUpdate() on every ingest so a '••' round-trip cannot clobber real keys.
import { aiSettings } from '../db/index.js';
import { codegenModelFor } from '../providers/llm-presets.js';
export { maskSecrets, applyMaskedUpdate } from '../util/secrets.js';

// One-level-deep merge: plain-object values merge per key, scalars/arrays replace, later wins.
export function mergeConfigLayers(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined) continue;
      const cur = out[k];
      if (isPlainObject(cur) && isPlainObject(v)) out[k] = { ...cur, ...v };
      else out[k] = v;
    }
  }
  return out;
}
function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

// P39 (raw-GSAP reference port): HyperFrame visual quality is dominated by the codegen model,
// not the prompt alone (memory: hyperframe-codegen-model). The reference app defaults to strong
// models (opus/gemini-pro); our AI-settings default (gpt-4o-mini / ag/gemini-3-flash-agent) is
// weak. Default codegen to the owner's stable strong proxy model — `ag/gemini-pro-agent` (the
// only strong model that isn't 429-quota-bound; memory: parity-harness-p0). This is a per-project
// override read by visuals.js (config.hyperframe.model → hfAi.llm.model); existing projects keep
// their stored snapshot, and any provider/channel value still wins. Point it at the codegen model
// your configured LLM provider actually serves.
// P45: the model is no longer a constant, because the owner may now be on Groq or DeepSeek,
// where `ag/gemini-pro-agent` does not exist. Measured against every other family, only Gemini
// writes scene markup that renders — so a preset declares a codegen model ONLY if it actually
// serves one, and '' means "no opinion, use the general model", which is what the per-project
// field's own placeholder already promises. An unrecognised endpoint (a private proxy) resolves
// to the value below, so an existing install is not moved a millimetre.
function strongCodegenModel() {
  try { return codegenModelFor(aiSettings().llm); } catch { return ''; }
}

// Base defaults for NEW projects: HyperFrame — the single visual mode (P36). Sits UNDER every
// other layer, so channel/preset/request always win; existing projects keep their stored config
// snapshot (this only runs at creation). Consumption-site fallbacks read `|| 'hyperframe'`, and
// migration 5 coerces any legacy 'animation'/'image' value, so a stray stored mode can never route.
const NEW_PROJECT_DEFAULTS = {
  visualMode: 'hyperframe',
  // P38 backgroundVariety: rotate the backdrop STYLE per scene (spotlight/aurora/grid/…) while the
  // palette + fonts stay LOCKED to the guide; set false to keep one motif across the whole video.
  hyperframe: { styleId: 'tuila1-hud-cyber', density: 'balanced', backgroundVariety: true },
  // Cinematic scene transitions ON by default: every boundary flows through a short dip through
  // black (planTransitions), with one role-driven hero transition punching above it. Sits under
  // every layer, so an explicit request/preset/channel value still wins.
  transitions: true,
  // The clip hands its content off at the edges, so the join has something to blend. It lives in
  // the NEW-project defaults for the same reason subtitleLane does, one comment down: this layer
  // runs only at creation, so the 46 projects that already have clips keep their stored config
  // and their render fingerprints do not move. Enabling it on an existing project is a deliberate,
  // priced re-render — a full one, since it changes every clip — and not a side effect of an
  // upgrade. The concat-side dip already improves those videos without re-rendering anything.
  hyperframeHandoff: true,
  // B2 script path: 'master' = the master script engine (one master prompt → canonical
  // scenes JSON with per-scene 8-bracket visuals). 'legacy' restores the old generateScript.
  scriptEngine: 'master',
  // Subtitles are printed onto the ASSEMBLED video, never baked into the clips (owner order
  // 2026-08-06). A caption drawn inside a clip is an INPUT to that clip: changing the font then
  // costs one render per scene, and there is no way to take it back out again. Burning once at
  // the join makes every later subtitle edit cost a single concat.
  //
  // It sits in the NEW-project defaults rather than at the consumption sites on purpose: this
  // layer only runs at creation, so projects that already have clips keep whatever their stored
  // config says and their render fingerprints do not move. Moving an existing project onto the
  // lane is a deliberate, priced act (services/change-plan.js), not a side effect of an upgrade.
  subtitleLane: 'final',
};

// Effective config for a new project. `preset` = the channel's default preset row (or null).
export function resolveProjectConfig({ channel, preset, request } = {}) {
  // Resolved at creation, not baked into the constant above, so the codegen model follows
  // whichever provider is configured TODAY. It sits under every other layer, so a channel,
  // a preset or the request still wins — and existing projects keep their stored snapshot.
  const codegen = { hyperframe: { model: strongCodegenModel() } };
  return mergeConfigLayers(NEW_PROJECT_DEFAULTS, codegen, channel?.config, preset?.config, request);
}

// AI settings with per-channel overrides layered per section (llm/tts/subtitle/imageGen/imageSearch).
export function aiSettingsFor(channel) {
  const base = aiSettings();
  const over = channel?.config?.ai;
  if (!over || typeof over !== 'object') return base;
  const out = { ...base };
  for (const section of Object.keys(over)) {
    if (isPlainObject(over[section]) && isPlainObject(base[section])) {
      out[section] = { ...base[section], ...over[section] };
    } else if (over[section] !== undefined) {
      out[section] = over[section];
    }
  }
  return out;
}

// The tts override layer the runner hands to synthesizeVoice():
// channel AI tts ⊕ project config tts (project wins — it may carry user per-video picks).
export function ttsOverrideFor(channel, projectConfig) {
  const ch = channel?.config?.ai?.tts;
  const pj = projectConfig?.tts;
  if (!ch && !pj) return undefined;
  return mergeConfigLayers(ch, pj);
}

