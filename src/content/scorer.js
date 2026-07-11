// Deterministic script quality gate — "B8 for words". No LLM, no I/O: pure checks over
// the scene list that catch what repairJson and lazy models silently ship:
//   lang-leak   — a scene narrated in the wrong language
//   truncated   — a voice line repairJson closed mid-sentence (no sentence-final punct)
//   under/over  — word budget far off the LANG_WPS slot (scene runs short / overflows)
//   repetition  — near-duplicate narration across scenes (folded 5-gram overlap)
import { detectLang } from '../util/lang.js';
import { wordCount } from '../util/util.js';
import { LANG_WPS } from '../providers/llm.js';

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
    if (!t) { issues.push({ idx: s.idx, type: 'empty', detail: 'lời thoại rỗng' }); return; }
    const wc = wordCount(t);
    if (langs[i] !== expected && wc >= 4) {
      issues.push({ idx: s.idx, type: 'lang-leak', detail: `lời thoại là '${langs[i]}' trong video '${expected}'` });
    }
    if (wc >= 6 && !ENDS_CLEAN.test(t)) {
      issues.push({ idx: s.idx, type: 'truncated', detail: 'câu kết thúc lửng (thiếu dấu chấm câu) — khả năng bị cắt cụt' });
    }
    if (wc < target * 0.5) {
      issues.push({ idx: s.idx, type: 'under-budget', detail: `${wc} từ < 50% ngân sách ~${Math.round(target)} — cảnh sẽ hụt thời lượng` });
    } else if (wc > target * 2.1) {
      issues.push({ idx: s.idx, type: 'over-budget', detail: `${wc} từ > 210% ngân sách ~${Math.round(target)} — cảnh sẽ tràn slot` });
    }
  });

  // cross-scene repetition: any pair sharing >60% of the smaller scene's 5-grams
  const grams = texts.map((t) => ngrams(t));
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const a = grams[i], b = grams[j];
      if (a.size < 3 || b.size < 3) continue;
      let shared = 0;
      for (const g of a) if (b.has(g)) shared++;
      if (shared / Math.min(a.size, b.size) > 0.6) {
        issues.push({ idx: scenes[j].idx, type: 'repetition', detail: `lặp gần nguyên văn cảnh ${scenes[i].idx + 1}` });
      }
    }
  }

  return { issues, flaggedIdx: [...new Set(issues.map((x) => x.idx))] };
}
