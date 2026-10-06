// b2.5 — EDITORIAL pass, run at the tail of B2 (same progress banner, no new step code).
// Deterministic scorer first (free, always on); for batched-length videos ONE whole-video
// coherence read-through (P33 — batch seams, paraphrased repeats, unresolved arc); then a
// bounded LLM rewrite of only the flagged scenes, drained in priority-ordered CHUNKS of 20
// (farewell > CTA > seam/arc > the rest — the old single .slice(0,20) silently never fixed
// overflow scenes on 200-scene videos). The scene COUNT is invariant by construction —
// rewrites are per-scene in-place voice edits, so the >=70% floor (P4) and the persona rule
// are never renegotiated. A deterministic strip floor runs AFTER the rewrite: a farewell or
// surplus CTA the model re-wrote around still cannot ship. Skipped on resume once voices
// exist (a rewrite after TTS would silently desync audio from script).
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { chatJson, llmEnabled, wordsForSlot } from '../../providers/llm.js';
import { scoreScript } from '../../content/scorer.js';
import { auditCtas, stripCtaSentences } from '../../content/cta-audit.js';
import { checkStop } from '../stop.js';
import { op } from '../progress.js';
import { resolveLang, langName } from '../../util/lang.js';

import { m, tp } from '../../i18n/t.js';
const CHUNK = 20;      // scenes per rewrite call (the old hard cap, now drained in rounds)
const MAX_CHUNKS = 3;  // bounded like every heal loop in this pipeline

// Type-keyed rewrite instructions — every scorer/coherence defect type MUST have an entry,
// or the model receives flagged scenes with unexplained tags.
const FIX_RULES = (lang, target) => `- lang-leak: rewrite ENTIRELY in ${langName(lang)}
- truncated: complete the cut-off sentence into a whole one
- under-budget: write it UP to ~${target} words (the line is too short for its scene duration)
- over-budget: tighten it DOWN to ~${target} words, keep the core idea
- repetition: re-express it with a DIFFERENT angle/example, never repeating the previous scene
- formulaic-hook: DELETE the closing filler question; end instead on a concrete, useful statement that lands this scene's takeaway
- device-monotony: rewrite so the scene ends on a STATEMENT, not a question (the video keeps at most one question, in the final scene only)
- thin: this scene is just a rhetorical question — rewrite it to TEACH one concrete, non-obvious thing with a specific named example the viewer can copy (never invent a statistic)
- farewell: DELETE the goodbye/thanks-for-watching — the video CONTINUES after this scene; end it mid-flow, bridging into the next scene's idea
- cta-excess: REMOVE the call-to-action sentence(s) — this video keeps only ONE soft CTA (~30%) and the closing CTA, and this scene is neither; keep the scene's informational content, add no CTA
- cta-cluster: REMOVE the call-to-action sentence(s) — CTAs must never cluster; keep the informational content only
- idea-repeat: this scene re-teaches an earlier scene's idea — replace it with a NEW facet, example or consequence that ADVANCES the argument
- hook-weak: this is the video's HOOK — rewrite to open COLD and concrete on the exact gap/tension (no greeting, no channel intro); make the viewer need the answer
- anchorless: keep the claim but add ONE concrete anchor — a specific named example, tool, place or real number that exists (never invent one)
- seam: this scene restarts/re-introduces as if the video began here (a batch seam) — rewrite it to CONTINUE the previous scene's thread mid-flow
- arc-unresolved: this is the CLOSING — rewrite it to resolve the exact gap/promise scene 1 opened, concretely, then the one natural closing line`;

const PRIORITY = { farewell: 0, 'cta-excess': 1, 'cta-cluster': 1, seam: 2, 'arc-unresolved': 2, 'idea-repeat': 3, 'hook-weak': 3 };

/**
 * P33 whole-video coherence read-through — batched videos only (single-call scripts are one
 * continuous talk already). ONE bounded LLM pass over a digest; returns scorer-shaped issues.
 * Best-effort: any failure returns [] (the deterministic findings still stand).
 */
async function coherenceReadThrough(scenes, { title, llm, projectId }) {
  const cap = Math.max(3, Math.round(scenes.length * 0.1));
  const digest = scenes.map((s) => `${s.idx}. ${String(s.voice_text || '').split(/\s+/).slice(0, 15).join(' ')}`).join('\n');
  try {
    const parsed = await chatJson([
      { role: 'system', content: 'You are a story editor for long educational videos. Reply with pure JSON.' },
      { role: 'user', content: `Video "${title}" — ${scenes.length} scenes, written in sequential batches. The digest shows each scene's opening words. Find ONLY these defects:
(a) "seam" — a scene that restarts or re-introduces the video as if it began there (batch seams);
(b) "repeat" — a scene re-teaching an EARLIER scene's idea with no new facet;
(c) "arc" — the ending fails to resolve what the opening promised (flag the LAST scene).
Digest:
${digest}
JSON: {"flags":[{"idx":N,"type":"seam|repeat|arc","reason":"one short sentence"}]} — at most ${cap} flags, the WORST ones only; [] if clean.` },
    ], { maxTokens: 2500, attempts: 2, temperature: 0.3, llm, validate: (p) => Array.isArray(p?.flags) });
    const typeMap = { seam: 'seam', repeat: 'idea-repeat', arc: 'arc-unresolved' };
    return parsed.flags.slice(0, cap)
      .filter((f) => scenes.some((s) => s.idx === Number(f.idx)) && typeMap[f.type])
      .map((f) => ({ idx: Number(f.idx), type: typeMap[f.type], detail: String(f.reason || '').slice(0, 160) }));
  } catch (e) {
    logger.warn(tp`Đọc-lại mạch truyện lỗi: ${e.message} — giữ các phát hiện tự động`, { projectId, stage: 'b2' });
    return [];
  }
}

/** Deterministic post-rewrite floor: a farewell/surplus CTA the model kept still cannot ship. */
function ctaStripFloor(projectId, config) {
  const scenes = DB.getScenes(projectId);
  const { defects } = auditCtas(scenes.map((s) => String(s.voice_text || '')));
  let stripped = 0;
  for (const d of defects) {
    for (const i of d.idx) {
      const sc = scenes[i];
      const { voice, removed, gutted } = stripCtaSentences(sc.voice_text, { farewellOnly: d.code === 'FAREWELL_MID' });
      if (!removed.length) continue;
      if (gutted) {
        // editorial cannot drop a scene (count is invariant here) — keep + loud journal line
        logger.warn(tp`Cảnh ${i + 1}: chỉ toàn CTA/tạm biệt giữa video, không tự cắt được — hãy sửa tay`, { projectId, stage: 'b2', sceneIdx: i });
        continue;
      }
      DB.updateScene(sc.id, { voice_text: voice });
      stripped++;
      logger.warn(tp`Cảnh ${i + 1}: cắt câu CTA/tạm biệt thừa ("${removed.join(' | ').slice(0, 80)}")`, { projectId, stage: 'b2', sceneIdx: i });
    }
  }
  return stripped;
}

/** @param {import('../context.js').PipelineContext} ctx */
export async function runEditorial(ctx) {
  const { projectId, project, config, ai } = ctx;
  if (config.editorial === false) return;
  let scenes = DB.getScenes(projectId);
  // Never rewrite once downstream artifacts are bound to this text: after TTS (the voice
  // speaks it), after the timing seed (srt_json set — scenes-first order means visuals were
  // planned from this text on any resume past the seed, including animation templates whose
  // on-screen words bake the script), after hyperframe codegen, or after the user approved
  // the scenes at the gate. On a FIRST pass the seed hasn't run yet, so editorial still runs
  // — including for B2 two-stage pre-assigned plans, same as before the reorder.
  if (!scenes.length || project.scenes_approved_at
    || scenes.some((s) => s.audio_path || s.srt_json || (s.template === 'hyperframe' && s.props?.script))) return;

  const { issues } = scoreScript(scenes, config);
  // P33: batched-length videos get ONE whole-video read-through for what per-scene checks
  // can't see (batch seams, paraphrase repeats, an unresolved arc).
  const coh = (llmEnabled(ai?.llm) && scenes.length > 30)
    ? await coherenceReadThrough(scenes, { title: project.title, llm: ai.llm, projectId }) : [];
  const allIssues = [...issues, ...coh];
  if (!allIssues.length) { op(projectId, m('🪶 Biên tập: kịch bản đạt — mạch lạc, không lỗi ngôn ngữ/cụt câu/lặp/CTA thừa')); return; }
  for (const i of allIssues.slice(0, 12)) logger.warn(tp`Biên tập: cảnh ${i.idx + 1} [${i.type}] ${i.detail}`, { projectId, stage: 'b2', sceneIdx: i.idx });
  const flaggedIdx = [...new Set(allIssues.map((x) => x.idx))];
  op(projectId, tp`🪶 Biên tập: ${flaggedIdx.length} cảnh cần sửa (${[...new Set(allIssues.map((x) => x.type))].join(', ')})`);

  if (!llmEnabled(ai?.llm)) return; // scorer findings are logged; offline mode keeps the script
  checkStop(projectId);

  // THE bug that put Vietnamese narration into an English video: this used to hardcode 'vi' when
  // config.language was unset (which was ALWAYS — nothing wrote it). Scenes flagged for entirely
  // unrelated defects ("truncated", "anchorless") then came back rewritten in Vietnamese, because
  // FIX_RULES(lang) says "rewrite ENTIRELY in <lang>" and the continuity line below pins the
  // Vietnamese forms of address. The scenes themselves are the authority on their own language.
  const lang = resolveLang(config, scenes);
  const target = wordsForSlot(config.sceneDuration || 7, lang);
  const byIdx = new Map(scenes.map((s) => [s.idx, s]));
  const tailOf = (t) => String(t || '').trim().slice(-90);
  const headOf = (t) => String(t || '').trim().slice(0, 90);
  const typesOf = (idx) => allIssues.filter((x) => x.idx === idx).map((x) => x.type);
  // priority-ordered drain: the worst defect classes always fit in the bounded chunks
  const ordered = flaggedIdx
    .sort((a, b) => (Math.min(...typesOf(a).map((t) => PRIORITY[t] ?? 9)) - Math.min(...typesOf(b).map((t) => PRIORITY[t] ?? 9))) || a - b)
    .slice(0, CHUNK * MAX_CHUNKS);

  let fixed = 0;
  try {
    for (let c = 0; c < ordered.length; c += CHUNK) {
      checkStop(projectId);
      scenes = DB.getScenes(projectId); // fresh rows — earlier chunks already landed
      const flagged = ordered.slice(c, c + CHUNK).map((idx) => byIdx.get(idx)).filter(Boolean)
        .map((s) => DB.getScene(s.id) || s);
      if (!flagged.length) continue;
      const list = flagged.map((s) => {
        const its = typesOf(s.idx).join('+');
        const prev = byIdx.get(s.idx - 1), next = byIdx.get(s.idx + 1);
        const cx = [prev ? `follows: "…${tailOf(prev.voice_text)}"` : '', next ? `leads into: "${headOf(next.voice_text)}…"` : ''].filter(Boolean).join(' | ');
        return `${s.idx}. [${its}] "${String(s.voice_text || '').slice(0, 400)}"${cx ? `\n   (continuity — this scene ${cx})` : ''}`;
      }).join('\n');
      const parsed = await chatJson([
        { role: 'system', content: 'You are a video script editor. Reply with pure JSON.' },
        { role: 'user', content: `Video "${project.title}". Rewrite ONLY the flawed narration lines below (keep the meaning, fix the bracketed issue):
${FIX_RULES(lang, target)}
CONTINUITY (always): each rewrite must still FOLLOW the previous scene and LEAD INTO the next (see each line's continuity note) — keep it part of one flowing talk, never a detached standalone sentence.${lang === 'vi' ? '\nUse the fixed Vietnamese forms of address "mình" (speaker) – "các bạn" (audience).' : ''}
Lines (idx. [issue] "narration"):
${list}
JSON: {"scenes":[{"idx":${flagged[0].idx},"voice":"..."}]} — exactly ${flagged.length} elements, idx unchanged.` },
      ], { maxTokens: flagged.length * Math.max(130, target * 4) + 400, attempts: 2, temperature: 0.5, llm: ai.llm,
        validate: (p) => Array.isArray(p.scenes) && p.scenes.length > 0 });

      for (const r of parsed.scenes) {
        const idx = Number(r.idx);
        const sc = flagged.find((s) => s.idx === idx);
        const voice = String(r.voice || '').trim();
        if (!sc || !voice || voice.length < 4) continue;
        DB.updateScene(sc.id, { voice_text: voice });
        fixed++;
      }
      if (ordered.length > CHUNK) op(projectId, tp`🪶 Biên tập: đã sửa đợt ${Math.floor(c / CHUNK) + 1}/${Math.ceil(ordered.length / CHUNK)}…`);
    }
    // deterministic floor after every rewrite: leftover farewell/surplus-CTA sentences are cut
    const strippedN = ctaStripFloor(projectId, config);
    const after = scoreScript(DB.getScenes(projectId), config);
    op(projectId, tp`🪶 Biên tập: đã viết lại ${fixed}/${ordered.length} cảnh${strippedN ? tp` + cắt ${strippedN} câu CTA/tạm biệt thừa` : ''} — còn ${after.flaggedIdx.length} cảnh có ghi chú`);
    logger.info(tp`🪶 Biên tập: sửa ${fixed}/${ordered.length} cảnh, cắt ${strippedN} câu thừa, còn ${after.flaggedIdx.length} cảnh bị đánh dấu`, { projectId, stage: 'b2' });
  } catch (e) {
    logger.warn(tp`Biên tập lỗi: ${e.message} — giữ kịch bản gốc`, { projectId, stage: 'b2' });
  }
}
