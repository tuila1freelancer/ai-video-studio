// Deterministic repairs: the user's closing block, loan words, the opening sentence, and the defect-driven repair pass (P18).
import { splitSentences } from '../../providers/llm.js';

import { tokenSet } from './validate.js';

/**
 * The user's closing block — the final `### ` section of the script, else its last 60 words.
 * This is the text the model keeps rewriting, and it is the one part we can put back exactly,
 * because it is sitting right there in the source.
 */
export function closingBlock(source) {
  const src = String(source || '').trim();
  if (!src) return '';
  const parts = src.split(/^###\s+.*$/m);
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  const body = (tail.trim() || src.split(/\s+/).slice(-60).join(' ')).trim();
  return body.replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim();
}

// The channel's substitution table (Courses/Khoa-AI-100-Bai/04-MAU-KICH-BAN.md §1). The voice
// reads what is typed, so an English word in the narration is a word the audience hears in a
// language the video is not in. Four of these reached a finished script — including one that
// named a product the user never mentioned — so the swap is deterministic rather than a rule
// the model is asked to remember. Product names are absent on purpose: those stay as they are.
const LOAN_WORDS = [
  ['prompt', 'câu lệnh'], ['framework', 'quy trình'], ['workflow', 'quy trình'],
  ['checklist', 'bảng kiểm'], ['template', 'mẫu'], ['context', 'bối cảnh'],
  ['file', 'tập tin'], ['email', 'thư điện tử'], ['link', 'đường dẫn'],
  ['deadline', 'hạn chót'], ['slide', 'trang trình chiếu'], ['note', 'ghi chú'],
  ['insight', 'điều đáng chú ý'], ['feedback', 'phản hồi'], ['output', 'kết quả'],
  ['update', 'cập nhật'], ['report', 'báo cáo'], ['meeting', 'cuộc họp'],
  ['tool', 'công cụ'], ['app', 'ứng dụng'], ['team', 'nhóm'], ['data', 'dữ liệu'],
];

/**
 * Swap the loan words a Vietnamese narration should never carry. Case-insensitive on the way in,
 * capital-preserving on the way out, so a sentence-initial "Prompt" comes back as "Câu lệnh".
 */
export function swapLoanWords(text) {
  let out = String(text || '');
  for (const [en, vi] of LOAN_WORDS) {
    out = out.replace(new RegExp(`\\b${en}\\b`, 'gi'), (m) => (
      m[0] === m[0].toUpperCase() ? vi[0].toUpperCase() + vi.slice(1) : vi
    ));
  }
  return out;
}

/**
 * The user's FIRST spoken sentence — the hook. Retention is decided in the opening seconds,
 * and this is the one line written for exactly that job.
 */
export function openingSentence(source) {
  const src = String(source || '').trim();
  if (!src) return '';
  const afterHead = src.replace(/^#[^\n]*\n/, '');
  const blocks = afterHead.split(/^###\s+.*$/m).map((b) => b.trim()).filter(Boolean);
  const body = (blocks[0] || afterHead).replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim();
  return splitSentences(body)[0]?.trim() || '';
}

/**
 * Put the user's opening sentence back. On the first run under the new hook rules the model
 * swapped a cold open — a line of dialogue in a meeting room — for a generic "many people tend
 * to..." sentence, which is the shape those rules exist to ban, and the video lost its first
 * three seconds.
 */
function repairOpening(scenes, source, code) {
  const first = openingSentence(source);
  if (!first || !scenes.length) return scenes;
  const want = tokenSet(first, code);
  const got = tokenSet(scenes[0].voice, code);
  let kept = 0;
  for (const t of want) if (got.has(t)) kept++;
  if (want.size && kept / want.size >= 0.7) return scenes; // the model kept it — leave it alone
  return [{ ...scenes[0], voice: first }, ...scenes.slice(1)];
}

/**
 * Put the user's closing block back, one sentence per trailing scene. Three videos in a row
 * ended on wording the channel never approved: the re-ask alone does not fix it, and the text
 * is known, so this repairs rather than complains.
 */
function repairEnding(scenes, source) {
  const block = closingBlock(source);
  if (!block || !scenes.length) return scenes;
  const sents = splitSentences(block).map((x) => x.trim()).filter(Boolean);
  if (!sents.length) return scenes;
  // At most the last three scenes, and never the whole video: the closing block is short, and
  // a long one must not eat narration that was fine.
  const n = Math.max(1, Math.min(sents.length, 3, scenes.length - 1));
  // group the sentences into n ordered buckets, so a long block still lands on n scenes
  const buckets = Array.from({ length: n }, () => []);
  sents.forEach((sent, i) => buckets[Math.min(n - 1, Math.floor((i * n) / sents.length))].push(sent));
  const out = scenes.slice();
  for (let k = 0; k < n; k++) {
    const sc = out[out.length - n + k];
    out[out.length - n + k] = { ...sc, voice: buckets[k].join(' ') };
  }
  return out;
}

// Deterministic final repair: drop unspeakable scenes, strip broken/duplicated visuals
// (direction.js re-directs those), renumber. This is the P18 floor — a META_LEAK voice can
// never leave this function alive.
export function repairScenesSpec(spec, defects, { source = '', first = false, language = '' } = {}) {
  const dropStt = new Set(); const stripStt = new Set();
  for (const d of defects) {
    const list = Array.isArray(d.stt) ? d.stt : d.stt != null ? [d.stt] : [];
    if (d.code === 'META_LEAK' || d.code === 'NOT_SPEAKABLE' || d.code === 'EMPTY') list.forEach((x) => dropStt.add(x));
    if (d.code === 'BRACKETS' || d.code === 'MONOTONY') list.forEach((x) => stripStt.add(x));
  }
  let scenes = spec.scenes
    .filter((sc) => !dropStt.has(sc.stt))
    .map((sc, i) => ({ stt: i + 1, voice: sc.voice, visual: stripStt.has(sc.stt) ? '' : sc.visual, assets: sc.assets }));
  if (source && defects.some((d) => d.code === 'ENDING_REWRITTEN')) scenes = repairEnding(scenes, source);
  if (source && first) scenes = repairOpening(scenes, source, language);
  if (language === 'vi') scenes = scenes.map((sc) => ({ ...sc, voice: swapLoanWords(sc.voice) }));
  return { ...spec, scenes };
}
