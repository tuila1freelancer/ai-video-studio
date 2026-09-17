// The pinned outline restated to every batch so batch 2+ never re-plans the arc (P33).
import { chatJson, LANG_NAME } from '../../providers/llm.js';
import { tp } from '../../i18n/t.js';
import { BATCH_SIZE } from './plan.js';

// ---------------------------------------------------------------- pinned outline (P33)
/** Deterministic chapter normalizer: sorted, gapless, exact 1..targetCount coverage. */
export function normalizeChapters(raw, targetCount) {
  const chs = (raw || []).map((c) => ({
    from: Math.max(1, parseInt(c?.from, 10) || 1),
    to: Math.min(targetCount, parseInt(c?.to, 10) || targetCount),
    goal: String(c?.goal || '').trim().slice(0, 300),
    keyPoints: Array.isArray(c?.keyPoints) ? c.keyPoints.map((k) => String(k).trim()).filter(Boolean).slice(0, 4) : [],
    bridgeOut: String(c?.bridgeOut || '').trim().slice(0, 200),
  })).filter((c) => c.to >= c.from).sort((a, b) => a.from - b.from);
  if (!chs.length) return [{ from: 1, to: targetCount, goal: '', keyPoints: [], bridgeOut: '' }];
  const out = [];
  let cursor = 1;
  for (const c of chs) {
    if (cursor > targetCount) break;
    out.push({ ...c, from: cursor, to: Math.min(Math.max(c.to, cursor), targetCount) });
    cursor = out[out.length - 1].to + 1;
  }
  out[out.length - 1].to = targetCount;
  return out;
}

/**
 * ONE planning call before any batch of a long topic/source video: throughline + spine +
 * batch-aligned chapters (goal/keyPoints/bridgeOut). Every batch then follows the SAME arc
 * instead of inventing its own. Best-effort: any failure returns null → legacy behavior
 * (the rolling tail alone), never a dead run. 'script' mode skips this — the owner's text
 * IS the arc and the word-balanced slicer already preserves it.
 */
export async function generateOutline({ plan, language, llm, onLog, targetCount, topicText, sourceDoc, mode }) {
  const langName = LANG_NAME[language] || language;
  const nCh = Math.ceil(targetCount / BATCH_SIZE);
  const srcBlock = mode === 'source' && sourceDoc?.text
    ? `\nSOURCE ARTICLE (research material):\n"""\n${String(sourceDoc.text).slice(0, 16000)}\n"""` : '';
  try {
    const parsed = await chatJson([
      { role: 'system', content: 'You are a film director planning a long educational video. Reply with pure JSON only.' },
      { role: 'user', content: `Plan a ${targetCount}-scene ${langName} video about: "${String(topicText).trim().slice(0, 400)}".${srcBlock}
Design the ONE arc the whole video argues, then cut it into ~${nCh} sequential chapters. Each chapter will be WRITTEN in a separate call by a writer who sees ONLY this plan + the previous batch's last lines — the plan must carry the thread for them.
JSON: {"throughline":"ONE sentence: the single argument the whole video makes","spine":["ordered steps that prove it — first = the exact gap to open on, last = the payoff that resolves it"],"chapters":[{"from":1,"to":${Math.min(BATCH_SIZE, targetCount)},"goal":"what this chapter must accomplish","keyPoints":["2-4 concrete points"],"bridgeOut":"the one-line idea that hands over to the next chapter"}]}
HARD RULES: chapters cover scenes 1..${targetCount} exactly, in order, no gaps or overlaps; goals/keyPoints are concrete and specific to THIS topic (never generic filler); throughline/spine/goals written in ${langName}.` },
    ], {
      maxTokens: 3500, attempts: 2, llm,
      validate: (p) => !!(p && p.throughline && Array.isArray(p.spine) && p.spine.length && Array.isArray(p.chapters) && p.chapters.length),
    });
    const outline = {
      throughline: String(parsed.throughline).trim().slice(0, 300),
      spine: parsed.spine.map((s) => String(s).trim()).filter(Boolean).slice(0, 12),
      chapters: normalizeChapters(parsed.chapters, targetCount),
    };
    onLog(tp`Kịch bản: đã ghim dàn ý — ${outline.chapters.length} chương, throughline: "${outline.throughline.slice(0, 80)}"`);
    return outline;
  } catch (e) {
    onLog(tp`Kịch bản: không tạo được dàn ý ghim (${String(e.message).slice(0, 80)}) — chạy kiểu cũ`);
    return null;
  }
}
