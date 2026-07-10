// Shared style-guide domain — the single visual-identity contract consumed by BOTH the
// animation engine and the hyperframe codegen system. Neither side owns it, so both can
// depend on it without a dependency cycle (see docs/architecture.md §3.2).
//
//   guide.js    schema + normalizeGuide + HF_DEFAULT_GUIDE + SAMPLE_SPEC  (pure)
//   theme.js    themeFromGuide + isLight                                  (pure)
//   presets.js  HF_PRESETS + presetById + resolveGuide + font stacks      (pure)
//   generate.js generateStyleGuide (LLM)                                  (I/O — providers/llm)
export { HF_DEFAULT_GUIDE, normalizeGuide, SAMPLE_SPEC } from './guide.js';
export { themeFromGuide, isLight } from './theme.js';
export { HF_PRESETS, presetById, resolveGuide, DISPLAY_FONTS, BODY_FONT, MONO_FONT } from './presets.js';
export { generateStyleGuide } from './generate.js';
