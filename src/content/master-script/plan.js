// Schema constants, the duration planner and the tolerant scenes-JSON input parser.
import { wordsForSlot } from '../../providers/llm.js';
import { safeJson } from '../../util/util.js';

// The 8 canonical visual sections (factory schema hard gate). A master visual must carry
// [MAIN FOCUS] plus at least MIN_BRACKETS of these to count as "directed".
export const VISUAL_BRACKETS = ['ENVIRONMENT', 'MAIN FOCUS', 'CAMERA', 'MOTION FLOW', 'LIGHTING & FX', 'TEXT STYLE', 'ON-SCREEN TEXT', 'MOOD'];
export const MIN_BRACKETS = 5;
export const BATCH_TRIGGER = 30; // > this many target scenes → batched generation
export const BATCH_SIZE = 25;
// Inputs of at least this many words are a DETAILED SCRIPT (light-polish mode), not a topic.
// Shared with stages/budget.js so "user's words → duration follows content" uses the same line.
export const SCRIPT_MODE_MIN_WORDS = 80;

// ---------------------------------------------------------------- duration planner
function structureGuideFor(videoDuration) {
  if (videoDuration < 90) return 'hook → one core insight → one concrete example → payoff + CTA';
  if (videoDuration < 300) return 'hook → the problem → the core explanation → 2-3 concrete examples/steps → one common mistake + fix → recap + CTA';
  return 'hook → problem/misconception → core concept explained simply → step-by-step process → 3+ real examples → common mistakes + fixes → checklist recap → CTA';
}

/**
 * P33 — the per-video CTA budget: ONE soft CTA near 30% + the closing line in the final
 * scene. Batched prompts reference these as absolute stt AND span-relative positions;
 * everything else gets an explicit prohibition (the per-batch CTA duplication this kills
 * was measured on real output: subscribe blocks at every 25-scene boundary + a farewell
 * at scene 175/200).
 */
export function ctaPlanFor(targetCount) {
  const softStt = Math.min(Math.max(2, Math.round(targetCount * 0.3)), Math.max(2, targetCount - 2));
  return { softStt, closingStt: targetCount };
}

/** Word/scene arithmetic shared by the prompt, the validator and the batcher. */
export function planScenes({ videoDuration = 60, sceneDuration = 7, language = 'vi' } = {}) {
  const safeSceneDuration = Math.min(12, Math.max(4, +sceneDuration || 7));
  const dur = Math.max(10, +videoDuration || 60);
  const sceneCount = Math.max(1, Math.round(dur / safeSceneDuration));
  const wordsPerScene = wordsForSlot(safeSceneDuration, language);
  return {
    videoDuration: dur, sceneDuration: safeSceneDuration, sceneCount, wordsPerScene,
    minWords: Math.max(4, wordsPerScene - 3), maxWords: wordsPerScene + 4,
    totalWords: sceneCount * wordsPerScene, structureGuide: structureGuideFor(dur),
  };
}

// ---------------------------------------------------------------- tolerant input parse
/** Pasted scenes JSON (factory format, {script:[…]}, or a bare array) → raw object, else null. */
export function parseScenesInput(text) {
  const s = String(text || '').trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return null;
  const parsed = safeJson(s, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const arr = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed.scenes) ? parsed.scenes
      : Array.isArray(parsed.script) ? parsed.script
        : Object.values(parsed).find((v) => Array.isArray(v));
  if (!Array.isArray(arr) || !arr.length) return null;
  if (!arr.some((x) => x && typeof x === 'object' && (x.voice || x.text || x.narration))) return null;
  return parsed;
}
