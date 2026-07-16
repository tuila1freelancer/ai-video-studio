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

// Base defaults for NEW projects (the app's showcase mode): HyperFrame with the channel's
// signature style. Sits UNDER every other layer, so channel/preset/request always win;
// existing projects keep their stored config snapshot (this only runs at creation).
// Consumption-site fallbacks stay 'animation' so legacy rows without a visualMode are
// untouched on resume.
const NEW_PROJECT_DEFAULTS = {
  visualMode: 'hyperframe',
  hyperframe: { styleId: 'tuila1-hud-cyber', density: 'balanced' },
  // Cinematic scene transitions ON by default: every boundary flows through a short smooth
  // dissolve (planTransitions), with 1-2 role-driven hero transitions punching above it. Sits
  // under every layer, so an explicit request/preset/channel value still wins.
  transitions: true,
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

