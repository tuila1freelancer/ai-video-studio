// Per-video budget guardrail. settings.budget = { perVideoUsd: number|null }.
// Consulted ONCE per run (per-video decision, not per-scene): when a project's estimated
// spend has reached the cap, the pipeline context downgrades to the EXISTING free paths —
// llm disabled (generateScript → offlineScript, planner heuristics) and tts pinned to the
// free edge→say chain. No new provider switches are invented (P7's contract intact:
// the pin rides the same explicit-override lane a user's per-video pick uses).
import { getSetting, usageForProject } from '../db/index.js';

export function budgetState(projectId) {
  const cap = +(getSetting('budget', {})?.perVideoUsd) || 0;
  if (cap <= 0) return { capped: false, cap: 0, spent: 0 };
  const spent = usageForProject(projectId)?.estCost || 0;
  return { capped: spent >= cap, cap, spent };
}
