// Master script engine facade — planner, validator, repair, prompt, canonical shape, outline and the generator live under ./master-script; every existing import path keeps working.
export { VISUAL_BRACKETS, SCRIPT_MODE_MIN_WORDS, ctaPlanFor, planScenes, parseScenesInput } from './master-script/plan.js';
export { isMetaLeakVoice, validateScenesJson } from './master-script/validate.js';
export { closingBlock, swapLoanWords, openingSentence, repairScenesSpec } from './master-script/repair.js';
export { LANG_VOICE_NOTES, buildMasterPrompt } from './master-script/prompt.js';
export { scenesJsonFromRows } from './master-script/shape.js';
export { normalizeChapters } from './master-script/outline.js';
export { sourceSlicer, batchNoteFor, generateMasterScenes } from './master-script/generate.js';
