// Deterministic script quality gate — "B8 for words". No LLM, no I/O: pure checks over
// the scene list that catch what repairJson and lazy models silently ship:
//   lang-leak   — a scene narrated in the wrong language
//   truncated   — a voice line repairJson closed mid-sentence (no sentence-final punct)
//   under/over  — word budget far off the LANG_WPS slot (scene runs short / overflows)
//   repetition  — near-duplicate narration across scenes (folded 5-gram overlap)
//   formulaic-hook — scene ends on a short filler tag-question ("còn bạn?", "muốn thử?")
//   device-monotony — the video overuses closing questions (>1, or two scenes in a row)
//   thin        — the scene is only a rhetorical question, teaching nothing concrete
// P33 additions (CTA discipline + value density):
//   farewell    — goodbye/thanks-for-watching BEFORE the final scene (the video continues)
//   cta-excess / cta-cluster — more than the budget of ONE soft CTA + the closing CTA
//   idea-repeat — a later scene re-teaches an earlier scene's idea (paraphrase, not verbatim)
//   hook-weak   — scene 1 opens on a greeting/self-intro instead of the cold concrete gap
//   anchorless  — a short scene with no number and no named example (asserted, not taught)
import { detectLang } from '../util/lang.js';
import { wordCount } from '../util/util.js';
import { LANG_WPS, splitSentences } from '../providers/llm.js';
import { auditCtas } from './cta-audit.js';

import { m, tp } from '../i18n/t.js';
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
function ngrams(text, n = 5) {
  const toks = fold(text).replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= toks.length; i++) out.add(toks.slice(i, i + n).join(' '));
  return out;
}
const ENDS_CLEAN = /[.!?…。？！]["'”’)\]]?\s*$/;
// A line ends "open" — on a conjunction/preposition/article/comma — so even a short line is a
// mid-thought cut, not a stubby-but-complete sentence.
const ENDS_OPEN = /(?:^|\s)(và|hoặc|hay|nhưng|mà|của|cho|với|trong|khi|để|thì|rằng|nên|vì|nếu|bởi|the|a|an|and|or|but|of|to|in|on|for|with|as|at|by|that)\s*$/i;
const isQuestion = (s) => /[?？]["'”’)\]]?\s*$/.test(String(s || '').trim());
function lastSentence(t) {
  const ss = splitSentences(t);
  return ss.length ? ss[ss.length - 1] : String(t || '').trim();
}

/**
 * @param {{idx:number, voice_text:string}[]} scenes
 * @param {{language?:string, sceneDuration?:number}} config
 * @returns {{issues: {idx:number, type:string, detail:string}[], flaggedIdx: number[]}}
 */
export function scoreScript(scenes, config = {}) {
  const issues = [];
  const texts = scenes.map((s) => String(s.voice_text || ''));
  // expected language: explicit config, else the majority of the script
  const langs = texts.map((t) => detectLang(t));
  const expected = (config.language && config.language !== 'auto')
    ? config.language
    : [...langs].sort((a, b) => langs.filter((l) => l === a).length - langs.filter((l) => l === b).length).pop();
  const wps = LANG_WPS[expected] || 3.0;
  const slot = Math.max(3, config.sceneDuration || 7);
  const target = slot * wps;

  scenes.forEach((s, i) => {
    const t = texts[i].trim();
    if (!t) { issues.push({ idx: s.idx, type: 'empty', detail: m('lời thoại rỗng') }); return; }
    const wc = wordCount(t);
    if (langs[i] !== expected && wc >= 4) {
      issues.push({ idx: s.idx, type: 'lang-leak', detail: tp`lời thoại là '${langs[i]}' trong video '${expected}'` });
    }
    // truncated: an unterminated line at wc>=6, OR a short line that ends "open" on a
    // conjunction/preposition (a clear mid-thought cut even under the old 6-word floor)
    if (!ENDS_CLEAN.test(t) && (wc >= 6 || (wc >= 3 && ENDS_OPEN.test(t)))) {
      issues.push({ idx: s.idx, type: 'truncated', detail: m('câu kết thúc lửng (thiếu dấu chấm câu / dừng ở từ nối) — khả năng bị cắt cụt') });
    }
    if (wc < target * 0.5) {
      issues.push({ idx: s.idx, type: 'under-budget', detail: tp`${wc} từ < 50% ngân sách ~${Math.round(target)} — cảnh sẽ hụt thời lượng` });
    } else if (wc > target * 2.1) {
      issues.push({ idx: s.idx, type: 'over-budget', detail: tp`${wc} từ > 210% ngân sách ~${Math.round(target)} — cảnh sẽ tràn slot` });
    }
    // formulaic-hook: the scene ends on a short filler question ("còn bạn?", "muốn thử không?")
    const last = lastSentence(t);
    if (isQuestion(last) && wordCount(last) <= 7) {
      issues.push({ idx: s.idx, type: 'formulaic-hook', detail: m('kết bằng câu hỏi mồi ngắn — thay bằng một ý giá trị cụ thể') });
    }
    // thin: the whole scene is only rhetorical question(s) with no concrete anchor — teaches nothing
    const sents = splitSentences(t);
    if (wc >= 4 && sents.length > 0 && sents.every(isQuestion) && !/\d/.test(t)) {
      issues.push({ idx: s.idx, type: 'thin', detail: m('cảnh chỉ gồm câu hỏi tu từ, không có thông tin cụ thể để người xem áp dụng') });
    }
  });

  // device-monotony: overused closing questions — the video should carry at most ONE
  // viewer-directed question, and never two scenes in a row ending on "?".
  const qEnders = scenes.map((s, i) => (isQuestion(texts[i]) ? i : -1)).filter((i) => i >= 0);
  if (qEnders.length > 1) {
    const dm = new Set(qEnders.slice(1)); // every question-ender past the first
    for (let i = 1; i < scenes.length; i++) if (isQuestion(texts[i]) && isQuestion(texts[i - 1])) dm.add(i);
    for (const i of [...dm].sort((a, b) => a - b)) {
      issues.push({ idx: scenes[i].idx, type: 'device-monotony', detail: m('nhiều cảnh cùng kết bằng câu hỏi — chỉ giữ tối đa 1 câu hỏi cho cả video') });
    }
  }

  // cross-scene repetition: any pair sharing >60% of the smaller scene's 5-grams
  const grams = texts.map((t) => ngrams(t));
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const a = grams[i], b = grams[j];
      if (a.size < 3 || b.size < 3) continue;
      let shared = 0;
      for (const g of a) if (b.has(g)) shared++;
      if (shared / Math.min(a.size, b.size) > 0.6) {
        issues.push({ idx: scenes[j].idx, type: 'repetition', detail: tp`lặp gần nguyên văn cảnh ${scenes[i].idx + 1}` });
      }
    }
  }

  // P33 — CTA discipline: budget = ONE soft CTA mid-video + the closing CTA; a farewell
  // before the final scene is always a defect (batched generation used to write one per batch).
  const ctaTypeMap = { FAREWELL_MID: 'farewell', CTA_EXCESS: 'cta-excess', CTA_CLUSTER: 'cta-cluster' };
  for (const d of auditCtas(texts).defects) {
    for (const i of d.idx) {
      issues.push({ idx: scenes[i].idx, type: ctaTypeMap[d.code] || 'cta-excess', detail: d.detail });
    }
  }

  // P33 — hook-weak: scene 1 must open cold on the gap, never on a greeting/channel intro.
  if (texts.length) {
    const h = fold(texts[0]);
    if (/(xin chao|chao mung|chao cac ban|chao tat ca|hello everyone|welcome (back |to ))/.test(h)) {
      issues.push({ idx: scenes[0].idx, type: 'hook-weak', detail: m('cảnh mở đầu chào hỏi thay vì vào thẳng vấn đề — hook phải lạnh và cụ thể') });
    }
  }

  // P33 — idea-repeat: paraphrased re-teaching (verbatim 5-grams above can't see it).
  // Content-token Jaccard ≥0.6 between NON-adjacent scenes (adjacent scenes legitimately share
  // vocabulary while building on each other).
  const contentTokens = (t) => new Set(fold(t).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3));
  const csets = texts.map(contentTokens);
  const repFlagged = new Set(issues.filter((x) => x.type === 'repetition').map((x) => x.idx));
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 2; j < scenes.length; j++) {
      const a = csets[i], b = csets[j];
      if (a.size < 6 || b.size < 6 || repFlagged.has(scenes[j].idx)) continue;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter++;
      if (inter / (a.size + b.size - inter) >= 0.6) {
        issues.push({ idx: scenes[j].idx, type: 'idea-repeat', detail: tp`diễn đạt lại ý của cảnh ${scenes[i].idx + 1} mà không thêm khía cạnh mới` });
        repFlagged.add(scenes[j].idx);
      }
    }
  }

  // P33 — anchorless: a short scene with no number and no proper-noun-ish anchor teaches
  // nothing checkable. Mid-sentence capitalized word ≈ a named example/tool/place.
  scenes.forEach((s, i) => {
    const t = texts[i].trim();
    const wc = wordCount(t);
    if (!t || wc < 4 || wc >= target * 0.6) return;
    const hasDigit = /\d/.test(t);
    const hasProper = /(?<=[^.!?…:]\s)[A-ZÀ-Ỹ][\p{L}]+/u.test(t);
    // complements under-budget (a short scene that ALSO lacks anchors gets both tags — the
    // rewrite then expands it WITH a concrete example, not just more words)
    if (!hasDigit && !hasProper && !issues.some((x) => x.idx === s.idx && x.type === 'thin')) {
      issues.push({ idx: s.idx, type: 'anchorless', detail: m('cảnh ngắn, không có con số hay ví dụ/tên cụ thể — khẳng định suông, chưa dạy được gì') });
    }
  });

  return { issues, flaggedIdx: [...new Set(issues.map((x) => x.idx))] };
}
