// b2.5 — EDITORIAL pass, run at the tail of B2 (same progress banner, no new step code).
// Deterministic scorer first (free, always on); then ONE bounded LLM rewrite of only the
// flagged scenes (mirrors the _qcAttempt<1 discipline). The scene COUNT is invariant by
// construction — rewrites are per-scene in-place voice edits, so the >=70% floor (P4) and
// the persona rule are never renegotiated. Skipped on resume once voices exist (a rewrite
// after TTS would silently desync audio from script).
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { chatJson, llmEnabled, LANG_WPS } from '../../providers/llm.js';
import { scoreScript } from '../../content/scorer.js';
import { checkStop } from '../stop.js';
import { op } from '../progress.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runEditorial(ctx) {
  const { projectId, project, config, ai } = ctx;
  if (config.editorial === false) return;
  const scenes = DB.getScenes(projectId);
  if (!scenes.length || scenes.some((s) => s.audio_path)) return; // post-TTS: never rewrite

  const { issues, flaggedIdx } = scoreScript(scenes, config);
  if (!issues.length) { op(projectId, '🪶 Biên tập: kịch bản đạt — không lỗi ngôn ngữ/cụt câu/lặp'); return; }
  for (const i of issues.slice(0, 12)) logger.warn(`editorial: scene ${i.idx + 1} [${i.type}] ${i.detail}`, { projectId });
  op(projectId, `🪶 Biên tập: ${flaggedIdx.length} cảnh cần sửa (${[...new Set(issues.map((x) => x.type))].join(', ')})`);

  if (!llmEnabled(ai?.llm)) return; // scorer findings are logged; offline mode keeps the script
  checkStop(projectId);

  const lang = (config.language && config.language !== 'auto') ? config.language : 'vi';
  const wps = LANG_WPS[lang] || 3.0;
  const target = Math.round(Math.max(3, config.sceneDuration || 7) * wps);
  const flagged = scenes.filter((s) => flaggedIdx.includes(s.idx)).slice(0, 20);
  const list = flagged.map((s) => {
    const its = issues.filter((x) => x.idx === s.idx).map((x) => x.type).join('+');
    return `${s.idx}. [${its}] "${String(s.voice_text || '').slice(0, 400)}"`;
  }).join('\n');

  try {
    // ONE bounded rewrite pass — no loops (the same discipline as the QC repair cycle)
    const parsed = await chatJson([
      { role: 'system', content: 'Bạn là biên tập viên kịch bản video. Trả về JSON thuần.' },
      { role: 'user', content: `Video "${project.title}". Viết lại CHỈ các câu thoại lỗi dưới đây (giữ đúng ý, sửa lỗi trong ngoặc):
- lang-leak: viết lại HOÀN TOÀN bằng ${lang === 'vi' ? 'tiếng Việt' : lang}
- truncated: hoàn thiện câu bị cắt cụt thành câu trọn vẹn
- under-budget: viết ĐỦ ~${target} từ (câu đang quá ngắn so với thời lượng cảnh)
- over-budget: rút gọn về ~${target} từ, giữ ý chính
- repetition: diễn đạt lại bằng góc nhìn/ví dụ KHÁC, không lặp cảnh trước${lang === 'vi' ? '\nXưng hô cố định "mình – các bạn".' : ''}
Các câu (idx. [lỗi] "thoại"):
${list}
JSON: {"scenes":[{"idx":${flagged[0].idx},"voice":"..."}]} — đúng ${flagged.length} phần tử, idx giữ nguyên.` },
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
