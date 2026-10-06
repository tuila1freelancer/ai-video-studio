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

// P39: HyperFrame visual quality is dominated by the codegen model, not the prompt alone. It
// reaches the render as a per-project
// override read by visuals.js (config.hyperframe.model → hfAi.llm.model), so existing projects
// keep their stored snapshot and any channel/preset/request value still wins.
//
// ai-providers amends it: this used to be the constant `ag/gemini-pro-agent`, which exists only
// on the user's own proxy — a guaranteed render failure once the provider picker let someone
// choose Groq. The requirement is unchanged (measured against every other family, only Gemini
// writes scene markup that renders), so a preset declares a codegen model ONLY when it genuinely
// serves one. '' means "no opinion, use the general model" — exactly what the per-project field's
// own placeholder already promises for a blank value — and an endpoint the catalogue does not
// recognise still resolves to the original model, so a private-proxy install does not move.
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
  // Subtitles are printed onto the ASSEMBLED video, never baked into the clips. A caption drawn inside a clip is an INPUT to that clip: changing the font then
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

