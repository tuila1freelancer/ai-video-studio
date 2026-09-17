// HyperFrame codegen prompt facade — the system doctrine, the per-scene blocks, the layout tables and the animation spec live under ./prompt; every existing import path keeps working.
export { codegenSystem } from './prompt/system.js';
export { densityForScene, overlayBlock, scriptTextRule } from './prompt/blocks.js';
export { ratioClass, viewportBlock, ratioRulesBlock } from './prompt/layout.js';
export { animationSpecBlock, timelineSkeletonBlock, creativeLibsBlock } from './prompt/animation.js';
export { buildCodegenPrompt } from './prompt/build.js';
