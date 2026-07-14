// b2.5 — EDITORIAL pass, run at the tail of B2 (same progress banner, no new step code).
// Deterministic scorer first (free, always on); then ONE bounded LLM rewrite of only the
// flagged scenes (mirrors the _qcAttempt<1 discipline). The scene COUNT is invariant by
// construction — rewrites are per-scene in-place voice edits, so the >=70% floor (P4) and
// the persona rule are never renegotiated. Skipped on resume once voices exist (a rewrite
// after TTS would silently desync audio from script).
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { chatJson, llmEnabled, LANG_WPS, wordsForSlot } from '../../providers/llm.js';
import { scoreScript } from '../../content/scorer.js';
import { checkStop } from '../stop.js';
import { op } from '../progress.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runEditorial(ctx) {
  const { projectId, project, config, ai } = ctx;
  if (config.editorial === false) return;
  const scenes = DB.getScenes(projectId);
  // Never rewrite once downstream artifacts are bound to this text: after TTS (the voice
  // speaks it), after the timing seed (srt_json set — scenes-first order means visuals were
  // planned from this text on any resume past the seed, including animation templates whose
  // on-screen words bake the script), after hyperframe codegen, or after the owner approved
  // the scenes at the gate. On a FIRST pass the seed hasn't run yet, so editorial still runs
  // — including for B2 two-stage pre-assigned plans, same as before the reorder.
  if (!scenes.length || project.scenes_approved_at
    || scenes.some((s) => s.audio_path || s.srt_json || (s.template === 'hyperframe' && s.props?.script))) return;

  const { issues, flaggedIdx } = scoreScript(scenes, config);
  if (!issues.length) { op(projectId, '🪶 Biên tập: kịch bản đạt — không lỗi ngôn ngữ/cụt câu/lặp'); return; }
  for (const i of issues.slice(0, 12)) logger.warn(`editorial: scene ${i.idx + 1} [${i.type}] ${i.detail}`, { projectId });
  op(projectId, `🪶 Biên tập: ${flaggedIdx.length} cảnh cần sửa (${[...new Set(issues.map((x) => x.type))].join(', ')})`);

  if (!llmEnabled(ai?.llm)) return; // scorer findings are logged; offline mode keeps the script
  checkStop(projectId);

  const lang = (config.language && config.language !== 'auto') ? config.language : 'vi';
  const wps = LANG_WPS[lang] || 3.0;
  const target = wordsForSlot(config.sceneDuration || 7, lang);
  const flagged = scenes.filter((s) => flaggedIdx.includes(s.idx)).slice(0, 20);
  const list = flagged.map((s) => {
    const its = issues.filter((x) => x.idx === s.idx).map((x) => x.type).join('+');
    return `${s.idx}. [${its}] "${String(s.voice_text || '').slice(0, 400)}"`;
  }).join('\n');

  try {
    // ONE bounded rewrite pass — no loops (the same discipline as the QC repair cycle)
    const parsed = await chatJson([
      { role: 'system', content: 'You are a video script editor. Reply with pure JSON.' },
      { role: 'user', content: `Video "${project.title}". Rewrite ONLY the flawed narration lines below (keep the meaning, fix the bracketed issue):
- lang-leak: rewrite ENTIRELY in ${lang === 'vi' ? 'Vietnamese' : lang}
- truncated: complete the cut-off sentence into a whole one
- under-budget: write it UP to ~${target} words (the line is too short for its scene duration)
- over-budget: tighten it DOWN to ~${target} words, keep the core idea
- repetition: re-express it with a DIFFERENT angle/example, never repeating the previous scene${lang === 'vi' ? '\nUse the fixed Vietnamese forms of address "mình" (speaker) – "các bạn" (audience).' : ''}
Lines (idx. [issue] "narration"):
${list}
JSON: {"scenes":[{"idx":${flagged[0].idx},"voice":"..."}]} — exactly ${flagged.length} elements, idx unchanged.` },
    ], { maxTokens: flagged.length * Math.max(130, target * 4) + 400, attempts: 2, temperature: 0.5, llm: ai.llm,
      validate: (p) => Array.isArray(p.scenes) && p.scenes.length > 0 });

    let fixed = 0;
    for (const r of parsed.scenes) {
      const idx = Number(r.idx);
      const sc = flagged.find((s) => s.idx === idx);
      const voice = String(r.voice || '').trim();
      if (!sc || !voice || voice.length < 4) continue;
      DB.updateScene(sc.id, { voice_text: voice });
      fixed++;
    }
    // verify: the rewrite must IMPROVE — more issues than before means keep the original? per-scene applied already;
    // re-score for the log so regressions are visible, never fatal
    const after = scoreScript(DB.getScenes(projectId), config);
    op(projectId, `🪶 Biên tập: đã viết lại ${fixed}/${flagged.length} cảnh — còn ${after.flaggedIdx.length} cảnh có ghi chú`);
    logger.info(`editorial rewrite: ${fixed}/${flagged.length} fixed, ${after.flaggedIdx.length} still flagged`, { projectId });
  } catch (e) {
    logger.warn(`editorial rewrite failed: ${e.message} — keeping the original script`, { projectId });
  }
}
