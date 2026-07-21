// P33 — CTA/farewell discipline detector (deterministic, no LLM, no I/O).
// The owner's contract: a video carries AT MOST one soft CTA mid-flow (~30%) + one closing
// CTA in the final scene, and NEVER a farewell ("hẹn gặp lại", "cảm ơn đã xem") before the
// end. Batched generation used to close every 25-scene batch with its own CTA block — the
// prompts now forbid it (master-script CTA PLAN) and THIS module enforces it: the scorer
// turns findings into editorial rewrites, and the zero-LLM floor strips/drops offenders
// (json imports included — the factory's own files carry 8 goodbye blocks per 200 scenes).
import { splitSentences } from '../providers/llm.js';

const fold = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

// Channel-CTA verbs demand channel context nearby — "đăng ký khóa học" is content, not CTA.
const CTA_RES = [
  /dang ky[^.!?…]{0,40}(kenh|channel)/,
  /subscribe/,
  /(nhan|bam|an|nho)[^.!?…]{0,25}chuong/,
  /(bat|mo)[^.!?…]{0,20}thong bao/,
  /(thich|like)[^.!?…]{0,30}(video|kenh)/,
  /chia se[^.!?…]{0,45}(video|kenh|bai viet|cho ban be|voi ban be|cho nguoi)/,
  /share (this )?(video|with)/,
  /(de lai|viet|dat|comment)[^.!?…]{0,20}binh luan/,
  /binh luan (ben duoi|phia duoi|xuong duoi)/,
  /comment (below|section)/,
  /luu (lai )?(video|bai viet|bai nay)/,
  /save this (video|post)/,
  /theo doi kenh/,
  /follow (the |our )?channel/,
];
const FAREWELL_RES = [
  /hen gap lai/,
  /tam biet/,
  /cam on[^.!?…]{0,35}(da |vi da )?(xem|theo doi|dong hanh|lang nghe|ung ho)/,
  /(gap|hen)[^.!?…]{0,35}(video|tap|so) (sau|toi|tiep theo|ke tiep)/,
  /(video|tap) (sau|tiep theo)[^.!?…]{0,15}(nhe|nha)\b/,
  /thanks? for watching/,
  /see you (in|next|soon)/,
  /\bgoodbye\b/,
];

/** Per-sentence classification of one narration line. */
export function classifyCta(voice) {
  const out = { cta: false, farewell: false, phrases: [] };
  for (const sent of splitSentences(String(voice || ''))) {
    const f = fold(sent);
    if (FAREWELL_RES.some((re) => re.test(f))) { out.farewell = true; out.phrases.push(sent.trim()); continue; }
    if (CTA_RES.some((re) => re.test(f))) { out.cta = true; out.phrases.push(sent.trim()); }
  }
  return out;
}

/**
 * Audit a whole script. `texts` = narration strings in scene order (0-based indexes out).
 * Budget: ≤1 CTA scene mid-video (the one nearest 30%) + the closing zone (last 2 scenes);
 * a farewell anywhere before the final scene is a defect, full stop.
 * @returns {{ ctaIdx:number[], farewellIdx:number[], defects:{code:string, idx:number[], detail:string}[] }}
 */
export function auditCtas(texts) {
  const n = texts.length;
  const marks = texts.map((t) => classifyCta(t));
  const ctaIdx = marks.flatMap((m, i) => (m.cta || m.farewell ? [i] : []));
  const farewellIdx = marks.flatMap((m, i) => (m.farewell ? [i] : []));
  const defects = [];
  if (!n) return { ctaIdx, farewellIdx, defects };

  // Closing zone: real endings often span the last TWO scenes ("Cảm ơn…" + "Hẹn gặp lại…"),
  // so videos of ≥8 scenes allow the pair; tiny scripts only the final scene.
  const closeStart = n - (n >= 8 ? 2 : 1);
  const midFarewell = farewellIdx.filter((i) => i < closeStart);
  if (midFarewell.length) {
    defects.push({ code: 'FAREWELL_MID', idx: midFarewell, detail: `chào tạm biệt/cảm ơn kết thúc ở giữa video (cảnh ${midFarewell.map((i) => i + 1).join(', ')}) — video vẫn còn tiếp diễn` });
  }
  const closingZone = (i) => i >= closeStart;
  const mid = ctaIdx.filter((i) => !closingZone(i) && !midFarewell.includes(i));
  if (mid.length > 1) {
    const keep = mid.reduce((best, i) => (Math.abs(i - 0.3 * n) < Math.abs(best - 0.3 * n) ? i : best), mid[0]);
    const extra = mid.filter((i) => i !== keep);
    defects.push({ code: 'CTA_EXCESS', idx: extra, detail: `quá nhiều CTA giữa video (${mid.length} cảnh) — chỉ giữ 1 CTA mềm quanh 30% (cảnh ${keep + 1}) + CTA chốt cuối` });
  }
  for (let k = 1; k < mid.length; k++) {
    if (mid[k] - mid[k - 1] < 5) {
      const already = defects.find((d) => d.code === 'CTA_CLUSTER');
      if (already) { if (!already.idx.includes(mid[k])) already.idx.push(mid[k]); }
      else defects.push({ code: 'CTA_CLUSTER', idx: [mid[k]], detail: 'các cảnh CTA dồn cụm sát nhau giữa video' });
    }
  }
  return { ctaIdx, farewellIdx, defects };
}

/**
 * Deterministic floor: remove CTA/farewell sentences from one narration line.
 * `gutted` = nothing informational remains (a farewell-only scene) → caller DROPS the scene.
 */
export function stripCtaSentences(voice, { farewellOnly = false } = {}) {
  const sents = splitSentences(String(voice || ''));
  const kept = []; const removed = [];
  for (const sent of sents) {
    const f = fold(sent);
    const isFarewell = FAREWELL_RES.some((re) => re.test(f));
    const isCta = !farewellOnly && CTA_RES.some((re) => re.test(f));
    if (isFarewell || isCta) removed.push(sent.trim());
    else kept.push(sent.trim());
  }
  return { voice: kept.join(' ').trim(), removed, gutted: kept.length === 0 && removed.length > 0 };
}
