// One answer to the only question an unattended run cannot answer for itself: is this video good
// enough to publish?
//
// Everything here already existed — the script audit, the typeset scan, the artifact-vs-database
// scan, the join's integrity report, the cost meter. What did not exist was a single reading of
// them, so an agent had to call five endpoints and invent its own policy from five shapes. This
// reads them all and says publishable: true/false with the reasons that decided it.
//
// It reports. It never edits, never renders, never publishes.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { apiError } from '../../core/api-codes.js';
import { atRiskScenes } from '../../pipeline/typeset-scan.js';
import { qcFinalVideo } from '../../pipeline/qc.js';
import { auditProjectScript } from '../../pipeline/stages/script-gate.js';
import { qcScan } from './qc-scan.js';
import { m } from '../../i18n/t.js';

/** Findings from the artifact scan that mean the video does not say what the project says it says. */
const SERIOUS_SCAN = new Set(['clip-missing', 'clip-stale', 'wrong-language']);

// `detail` is evidence, not prose: a count, a path, a list of codes. The words belong to whoever
// renders the verdict — an agent branches on `code`, and a person reads it in their own language.
const reason = (code, severity, detail) => ({ code, severity, detail });

/** The join's own report if the finished file still matches it, else a fresh probe. */
async function videoCheck(project, dir) {
  if (!project.video_path || !existsSync(project.video_path)) {
    return { ok: false, missing: true, issues: [] };
  }
  const saved = join(dir, 'qc_report.json');
  try {
    if (existsSync(saved) && statSync(saved).mtimeMs >= statSync(project.video_path).mtimeMs) {
      const report = JSON.parse(readFileSync(saved, 'utf8'));
      if (report?.qc) return { ok: !!report.qc.ok, missing: false, ...report.qc };
    }
  } catch { /* an unreadable report is not proof of anything — probe instead */ }
  const scenes = DB.getScenes(project.id);
  const expectDur = scenes.reduce((a, s) => a + (+s.duration || 0), 0);
  return { missing: false, ...(await qcFinalVideo(project.video_path, { expectDur })) };
}

/**
 * Read a project back and decide whether it may be published.
 * @param {string} projectId
 * @returns {Promise<object>} { publishable, score, reasons, checks, cost }
 */
export async function projectVerdict(projectId) {
  const project = DB.getProject(projectId);
  if (!project) throw apiError('not_found', m('not found'), 404);
  const config = project.config || {};
  const dir = DB.projectDirFor(projectId);
  const scenes = DB.getScenes(projectId);
  const reasons = [];

  // 1. Is it finished at all? Everything below describes a video; a run still in flight has none.
  if (project.status !== 'done') {
    reasons.push(reason('project.not_done', 'blocker', `status ${project.status}`));
  }

  // 2. The script, against the channel's own contract (opt-in — null when the channel has none).
  const script = auditProjectScript(projectId, config);
  if (script && !script.ok) {
    reasons.push(reason('script.audit', script.mode === 'block' ? 'blocker' : 'warning', script.fails.slice(0, 8).join(' · ')));
  }

  // 3. The scenes: text that will not fit, and clips that no longer match their design.
  const typeset = atRiskScenes(scenes);
  if (typeset.length) {
    reasons.push(reason('scenes.typeset_risk', 'warning', `${typeset.length}/${scenes.length}`));
  }
  let scan = { findings: [] };
  try { scan = qcScan(projectId); } catch { /* a scan that cannot run is not a defect of the video */ }
  const serious = scan.findings.filter((f) => SERIOUS_SCAN.has(f.kind));
  if (serious.length) {
    reasons.push(reason('scenes.stale_or_wrong_language', 'blocker', serious.slice(0, 5).map((f) => `#${f.sceneIdx} ${f.kind}`).join(', ')));
  }
  const otherFindings = scan.findings.length - serious.length;
  if (otherFindings > 0) reasons.push(reason('scenes.findings', 'warning', String(otherFindings)));

  // 4. The file itself: it exists, it carries both streams, it is as long as the voice.
  const video = await videoCheck(project, dir);
  if (video.missing) reasons.push(reason('video.missing', 'blocker', project.video_path || null));
  else for (const issue of video.issues || []) reasons.push(reason(`video.${issue.type}`, 'blocker', issue.detail));

  const blockers = reasons.filter((r) => r.severity === 'blocker');
  const warnings = reasons.filter((r) => r.severity === 'warning');
  return {
    projectId,
    publishable: blockers.length === 0,
    // A number for a dashboard, not a judgement: 100 minus what each finding costs.
    score: Math.max(0, 100 - blockers.length * 40 - warnings.length * 8),
    reasons,
    checks: {
      status: project.status,
      script: script ? { ok: script.ok, mode: script.mode, words: script.words, fails: script.fails } : null,
      scenes: { total: scenes.length, typesetAtRisk: typeset.length, findings: scan.findings },
      video: { path: project.video_path || null, ok: !video.missing && !(video.issues || []).length, duration: video.duration ?? null, issues: video.issues || [] },
    },
    cost: DB.usageForProject(projectId),
  };
}
