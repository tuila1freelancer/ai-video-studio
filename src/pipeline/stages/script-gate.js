// The value-and-policy gate on a finished script (opt-in, per channel).
//
// auditScript measures the PROMPT MASTER v2 contract — numbers per hundred words, sources spoken
// aloud, a worked calculation, no persona, no advice, no fear — and it is written for an English
// finance channel. So this is off unless a channel turns it on, and it says which profile it is
// judging by: a Vietnamese explainer would fail every clause for reasons that are not defects.
//
// 'warn' records the verdict and carries on. 'block' throws a config-class error: an auto-resume
// cannot fix a script that says the wrong things, and letting it run would spend the voice budget
// on narration the channel cannot publish.
import * as DB from '../../db/index.js';
import { auditScript } from '../../content/script-audit.js';
import { failed } from '../../core/errors.js';
import { logger } from '../../util/log.js';
import { op } from '../progress.js';
import { lang as langRow } from '../../i18n/languages.js';
import { resolveLang } from '../../util/lang.js';
import { m, tp } from '../../i18n/t.js';

/** Words per minute the length floor is measured against, when the channel does not pin one. */
const DEFAULT_WPM = 156;

/** @param {object} config @returns {{mode:'off'|'warn'|'block', wpm:number, minWords:number|undefined}} */
export function scriptAuditSettings(config = {}) {
  const raw = config.scriptAudit;
  const mode = typeof raw === 'string' ? raw : raw?.mode;
  return {
    mode: ['warn', 'block'].includes(mode) ? mode : 'off',
    wpm: +(raw?.wpm) || DEFAULT_WPM,
    minWords: +(raw?.minWords) || undefined,
  };
}

/** The whole narration, in scene order — what the audit reads. */
export const narrationOf = (scenes) => scenes.map((s) => String(s.voice_text || '').trim()).filter(Boolean).join('\n\n');

/**
 * Run the audit for a project and return its report (null when off or when there is nothing yet).
 * Pure enough to call from the verdict endpoint as well as from the pipeline.
 */
export function auditProjectScript(projectId, config = {}) {
  const settings = scriptAuditSettings(config);
  if (settings.mode === 'off') return null;
  const project = DB.getProject(projectId);
  const scenes = DB.getScenes(projectId);
  const text = narrationOf(scenes);
  if (!text) return null;
  // The floor follows the pinned voice's pace: a slower voice needs fewer words for the same minutes.
  const wpm = settings.wpm || Math.round((langRow(resolveLang(config, scenes)).wps || 2.6) * 60);
  return { mode: settings.mode, ...auditScript(text, { title: project?.title || '', wpm, minWords: settings.minWords }) };
}

/** @param {import('../context.js').PipelineContext} ctx */
export function runScriptGate(ctx) {
  const { projectId, config } = ctx;
  const report = auditProjectScript(projectId, config);
  if (!report) return null;
  if (report.ok) {
    op(projectId, tp`📐 Kiểm định kịch bản: đạt (${report.words} từ, ${report.per100} số/100 từ)`);
    return report;
  }
  const detail = report.fails.slice(0, 6).join(' · ');
  logger.warn(tp`📐 Kiểm định kịch bản: ${report.fails.length} điều chưa đạt — ${detail}`, { projectId, stage: 'b2' });
  if (report.mode === 'block') {
    op(projectId, tp`⛔ Kịch bản chưa đạt chuẩn kênh: ${detail}`);
    throw failed('script.audit-failed', m('kịch bản chưa đạt chuẩn giá trị/chính sách của kênh'));
  }
  op(projectId, tp`📐 Kiểm định kịch bản: ${report.fails.length} điều chưa đạt (chỉ cảnh báo)`);
  return report;
}
