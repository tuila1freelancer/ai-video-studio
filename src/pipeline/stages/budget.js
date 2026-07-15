// b2.75 — DURATION FIT. The script's total narration must MATCH the ordered video length:
// prompts ask for the budget, models drift, and per-scene drift compounds (the classic
// failure: a 35s order shipping at 50s+). This pass runs ONCE, after editorial and BEFORE
// the timing seed (so seeded durations + baked visuals see the final text), and enforces
// total-narration ≈ videoDuration within TOLERANCE:
//   over  → one bounded LLM tighten pass (per-scene quotas derived from the TOTAL deficit),
//           then a deterministic sentence-trim backstop (whole sentences only — the scorer's
//           truncation check must never re-flag what this pass wrote);
//   under → one LLM enrich pass (LLM off: kept — a slightly short video beats padded filler).
// Auto-duration mode and pasted-JSON scripts are the owner's words — never touched.
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { chatJson, llmEnabled, LANG_WPS, wordsForSlot, splitSentences } from '../../providers/llm.js';
import { checkStop } from '../stop.js';
import { op } from '../progress.js';

const TOLERANCE = 0.12; // ±12% of the ordered duration
const PAD_S = { vi: 0.65, other: 0.4 }; // mirror stages/tts.js padMsFor

// Unclamped speech estimate for the audit (the estimator's [2.5,40]s clamp distorts sums
// at the extremes — many tiny scenes inflate, one huge scene hides its overrun).
function estSec(text, wps, lang) {
  const words = (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).length;
  return words / Math.max(1, wps * 0.95) + (lang === 'vi' ? PAD_S.vi : PAD_S.other);
}
const wordsOf = (t) => (String(t || '').match(/[\p{L}\p{N}]+/gu) || []).length;

// A sentence that OPENS with a forward connector bridges FROM the previous scene — dropping it
// severs continuity. When trimming, prefer a low-information INTERIOR sentence and keep the
// opener (prev-bridge) and closer (next-bridge) so the reconciliation pass can't re-fracture
// the whole-script flow the generation built.
const CONNECTOR = /^(vì vậy|vì thế|do đó|bởi vậy|bởi thế|nhưng|vậy nên|thế nên|cho nên|và |rồi |sau đó|tiếp theo|nói cách khác|so |but |which is why|and |then )/i;
export function pickDroppable(sentences) {
  if (sentences.length >= 3) {
    // shortest interior sentence (lowest information), never the first or last
    let bi = 1, bw = Infinity;
    for (let i = 1; i < sentences.length - 1; i++) { const w = wordsOf(sentences[i]); if (w < bw) { bw = w; bi = i; } }
    return bi;
  }
  // 2 sentences: keep a connector-led opener (it bridges from the previous scene), drop the tail
  return sentences.length - 1;
}

// Chapter-break cards speak only their heading — by design far under any word quota; they
// must never be "enriched" into paragraphs nor counted as trim candidates.
const isBreak = (s) => s.template === 'chapter-break';

/** Pure audit — exported for tests. Returns totals + per-scene overruns vs quota. */
export function auditBudget(scenes, { videoDuration, sceneDuration, lang, wps }) {
  const per = scenes.map((s) => ({ id: s.id, idx: s.idx, brk: isBreak(s), est: estSec(s.voice_text, wps, lang), words: wordsOf(s.voice_text) }));
  const total = per.reduce((a, p) => a + p.est, 0);
  const drift = videoDuration > 0 ? (total - videoDuration) / videoDuration : 0;
  // SAME formula the prompts were budgeted with — a compliant script must audit at ~0 drift
  const quotaWords = wordsForSlot(sceneDuration, lang);
  return { per, total, drift, quotaWords };
}

/** Deterministic backstop: drop trailing sentences from the most-over scenes (never below
 *  one sentence) until the total fits. Returns a Map(sceneId -> trimmed voice) — exported
 *  pure for tests. */
export function trimToBudget(scenes, { videoDuration, sceneDuration, lang, wps }) {
  const out = new Map();
  const work = scenes.filter((s) => !isBreak(s)).map((s) => ({ id: s.id, sentences: splitSentences(s.voice_text || '') }));
  // chapter-break headings are untrimmable but still SPOKEN — count them toward the total
  const fixedSec = scenes.filter(isBreak).reduce((a, s) => a + estSec(s.voice_text, wps, lang), 0);
  const currentTotal = () => fixedSec + work.reduce((a, w) => a + estSec(w.sentences.join(' '), wps, lang), 0);
  const quotaWords = wordsForSlot(sceneDuration, lang);
  const limit = videoDuration * (1 + TOLERANCE);
  for (let guard = 0; guard < 200 && currentTotal() > limit; guard++) {
    // most-over scene that still has a sentence to spare
    let best = null, bestOver = 0;
    for (const w of work) {
      if (w.sentences.length <= 1) continue;
      const over = wordsOf(w.sentences.join(' ')) - quotaWords;
      if (over > bestOver) { bestOver = over; best = w; }
    }
    if (!best) break; // every scene is down to one sentence — cannot trim further
    best.sentences.splice(pickDroppable(best.sentences), 1); // bridge-aware: keep the prev/next connectors
    out.set(best.id, best.sentences.join(' '));
  }
  return out;
}

/** @param {import('../context.js').PipelineContext} ctx */
export async function runBudgetFit(ctx) {
  const { projectId, project, config, ai } = ctx;
  if (config.budgetFit === false) return;
  if (config.durationMode === 'auto') return;       // duration follows the pasted script
  {
    const lg = (config.language && config.language !== 'auto') ? config.language : 'vi';
    if (lg === 'ja' || lg === 'zh') return;          // no word boundaries — word math misfires
  }
  if (project.input_type === 'json') return;         // owner-authored scenes — never cut
  const scenes = DB.getScenes(projectId);
  // one-shot, pre-seed — same downstream-binding guards as editorial
  if (!scenes.length || project.scenes_approved_at
    || scenes.some((s) => s.audio_path || s.srt_json || (s.template === 'hyperframe' && s.props?.script))) return;

  const videoDuration = +config.videoDuration || 60;
  const sceneDuration = Math.max(3, +config.sceneDuration || 7);
  const lang = (config.language && config.language !== 'auto') ? config.language : 'vi';
  const wps = LANG_WPS[lang] || 3.0;
  const ask = () => auditBudget(DB.getScenes(projectId), { videoDuration, sceneDuration, lang, wps });

  let a = ask();
  if (Math.abs(a.drift) <= TOLERANCE) {
    op(projectId, `⏱️ Thời lượng lời thoại ~${a.total.toFixed(0)}s khớp mục tiêu ${videoDuration}s ✓`);
    return;
  }
  checkStop(projectId);

  // One bounded LLM pass toward the target (both directions). Quotas derive from the TOTAL
  // deficit so the instruction never fights itself (tighten one scene, pad another).
  if (llmEnabled(ai?.llm)) {
    const over = a.drift > 0;
    const offenders = [...a.per]
      .filter((p) => !p.brk)
      .map((p) => ({ ...p, delta: p.words - a.quotaWords }))
      .filter((p) => (over ? p.delta > 3 : p.delta < -3))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 14);
    if (offenders.length) {
      op(projectId, `⏱️ Lời thoại ${a.total.toFixed(0)}s ${over ? 'vượt' : 'hụt'} mục tiêu ${videoDuration}s — ${over ? 'siết' : 'bồi'} ${offenders.length} cảnh…`);
      const rows = DB.getScenes(projectId);
      const byIdx = new Map(rows.map((r) => [r.idx, r]));
      const listing = offenders.map((o) => {
        const sc = rows.find((r) => r.id === o.id);
        const prev = byIdx.get(o.idx - 1), next = byIdx.get(o.idx + 1);
        const ctx = [prev ? `follows "…${String(prev.voice_text || '').trim().slice(-70)}"` : '', next ? `leads into "${String(next.voice_text || '').trim().slice(0, 70)}…"` : ''].filter(Boolean).join(' | ');
        return `#${o.idx + 1} (now ${o.words} words, needs ~${a.quotaWords}): "${String(sc?.voice_text || '').slice(0, 700)}"${ctx ? `\n  (continuity — this scene ${ctx})` : ''}`;
      }).join('\n');
      try {
        const fix = await chatJson([
          { role: 'system', content: 'You are a video script editor. Reply with pure JSON.' },
          { role: 'user', content: `${over
            ? `The scenes below are OVER their word budget. Rewrite each one SHORTER to ~${a.quotaWords} words: keep the concrete takeaway and its named example; FIRST drop any trailing filler tag-question ("còn bạn?", "muốn thử không?", "right?"), then cut repetition/hedging.`
            : `The scenes below are UNDER their word budget. Rewrite each one LONGER to ~${a.quotaWords} words: add a concrete detail or a named example the viewer can use (NEVER invent a statistic), no rambling.`}
Keep each rewrite CONTINUOUS with its neighbors (see the continuity note): it must still follow the previous scene and lead into the next — one flowing talk, never a detached standalone line. Keep the original language and the existing forms of address. Output JSON {"fixes":[{"idx":scene number (1-based),"voice":"the new narration"}]} — only the scenes listed.
${listing}` },
        ], { maxTokens: offenders.length * a.quotaWords * 4 + 400, attempts: 2, temperature: 0.5,
          validate: (p) => Array.isArray(p.fixes) && p.fixes.length > 0, llm: ai.llm });
        const listed = new Set(offenders.map((o) => o.idx));
        for (const f of fix.fixes || []) {
          const target = rows.find((r) => r.idx === (f.idx | 0) - 1);
          const v = String(f.voice || '').trim();
          // a hallucinated idx must never rewrite a scene we did not list
          if (!target || !listed.has(target.idx) || isBreak(target) || v.length < 4) continue;
          // accept only fixes that move TOWARD the quota — a "shorter" reply that grew is noise
          const before = Math.abs(wordsOf(target.voice_text) - a.quotaWords);
          const after = Math.abs(wordsOf(v) - a.quotaWords);
          if (after < before) DB.updateScene(target.id, { voice_text: v });
        }
        a = ask();
      } catch (e) { logger.warn(`budget-fit LLM pass failed: ${e.message}`, { projectId }); }
    }
  }

  // Deterministic backstop for overruns only (padding filler in would hurt more than help).
  if (a.drift > TOLERANCE) {
    const trims = trimToBudget(DB.getScenes(projectId), { videoDuration, sceneDuration, lang, wps });
    for (const [id, voice] of trims) DB.updateScene(id, { voice_text: voice });
    a = ask();
  }
  const okMark = Math.abs(a.drift) <= TOLERANCE ? '✓'
    : a.drift > 0 ? `(vượt ${(a.drift * 100).toFixed(0)}% — đã tới giới hạn cắt an toàn)`
      : `(hụt ${(-a.drift * 100).toFixed(0)}% — giữ nguyên, không bồi chữ độn)`;
  op(projectId, `⏱️ Khớp thời lượng: lời thoại ~${a.total.toFixed(0)}s / mục tiêu ${videoDuration}s ${okMark}`);
  checkStop(projectId);
}
