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
const STRONG_CODEGEN_MODEL = 'ag/gemini-pro-agent';

// Base defaults for NEW projects: HyperFrame — the single visual mode (P36). Sits UNDER every
// other layer, so channel/preset/request always win; existing projects keep their stored config
// snapshot (this only runs at creation). Consumption-site fallbacks read `|| 'hyperframe'`, and
// migration 5 coerces any legacy 'animation'/'image' value, so a stray stored mode can never route.
const NEW_PROJECT_DEFAULTS = {
  visualMode: 'hyperframe',
  // P38 backgroundVariety: rotate the backdrop STYLE per scene (spotlight/aurora/grid/…) while the
  // palette + fonts stay LOCKED to the guide; set false to keep one motif across the whole video.
  hyperframe: { styleId: 'tuila1-hud-cyber', density: 'balanced', backgroundVariety: true, model: STRONG_CODEGEN_MODEL },
  // Cinematic scene transitions ON by default: every boundary flows through a short smooth
  // dissolve (planTransitions), with 1-2 role-driven hero transitions punching above it. Sits
  // under every layer, so an explicit request/preset/channel value still wins.
  transitions: true,
  // B2 script path: 'master' = the master script engine (one master prompt → canonical
  // scenes JSON with per-scene 8-bracket visuals). 'legacy' restores the old generateScript.
  scriptEngine: 'master',
};

// Effective config for a new project. `preset` = the channel's default preset row (or null).
export function resolveProjectConfig({ channel, preset, request } = {}) {
  return mergeConfigLayers(NEW_PROJECT_DEFAULTS, channel?.config, preset?.config, request);
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

