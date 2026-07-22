// Headline extraction — the one animation-era planner helper that survives the single-visual-
// mode collapse (P36). The 20-template heuristic/LLM planner was removed with the animation
// visual mode; `headline` still derives a short heading from a voice line for the two remaining
// callers: the P10 kinetic-statement self-heal (pipeline/stages/render.js) and the hyperframe
// fallback plan (animation/index.js).

const STOP = new Set(`the a an and or of to in on for with
là và của cho với trong đã sẽ được các những một này kia rằng khi bạn hãy có không thì mà nó vì nên bởi từ ra vào lên xuống
người việc điều cách rất cũng như nhiều hơn thứ nhất hai ba bốn năm sáu bảy tám chín mười luôn trước sau đang cần phải nếu để
dùng sử dụng làm giúp đây đó ấy vậy thật càng đều chỉ vẫn lại nữa mọi mỗi cùng theo về trên dưới giữa bằng hay còn thêm xong ngay`.split(/\s+/));

// short headline from a sentence: first clause, ≤ maxLen chars
export function headline(text, maxLen = 40) {
  let s = String(text || '').trim().split(/[.!?…]/)[0];
  const cut = s.split(/[,;:—–-]\s/)[0];
  if (cut.length >= 10) s = cut;
  if (s.length > maxLen) {
    const ws = s.split(/\s+/); s = '';
    for (const w of ws) { if ((s + ' ' + w).trim().length > maxLen) break; s = (s + ' ' + w).trim(); }
  }
  // never end a headline on a dangling function word ("với", "của", "để"…)
  const tail = s.split(/\s+/);
  while (tail.length > 3 && STOP.has(tail[tail.length - 1].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))) tail.pop();
  return tail.join(' ').trim();
}
