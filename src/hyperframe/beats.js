// HyperFrame beats + cinematic direction — pure functions, no I/O, no LLM.
//
// A "beat" is a keyword moment in the narration: the visual element for it must APPEAR at
// beat.t0 (right as the voice reaches the word) and be gone before the next beat. Times come
// from the scene's real word timestamps (scenes.srt_json — whisper or estimate), so visuals
// can never drift from the voice.
//
//   extractBeats(srtJson, keywords, duration) → [{ t0, t1, text, kind }]
//     kind: 'number' | 'keyword' | 'phrase'
//   cinematicDirection(scene, idx, total) → { pacing, energy, mood, camera, transition,
//     isClimax, isHook }  — the per-scene direction block embedded in the codegen prompt.

export function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

// stopwords are stored FOLDED — every membership test uses fold()ed tokens
const STOP = new Set(`the a an and or of to in on for with is are was be this that it as at by from
là và của cho với trong đã sẽ được các những một này kia rằng khi bạn hãy có không thì mà nó vì nên bởi từ ra vào lên xuống
người việc điều cách rất cũng như nhiều hơn thứ luôn trước sau đang cần phải nếu để biết thấy nghĩ vội đừng nào
dùng sử dụng làm giúp đây đó ấy vậy thật càng đều chỉ vẫn lại nữa mọi mỗi cùng theo về trên dưới giữa bằng hay còn thêm xong ngay
tui mình chúng ta anh chị em ơi nhé nha ạ à ừ thôi rồi`.split(/\s+/).map(fold));

function flatWords(srtJson) {
  const out = [];
  for (const cue of Array.isArray(srtJson) ? srtJson : []) {
    for (const w of cue.words || []) {
      const word = String(w.word || '').trim();
      if (word) out.push({ start: +w.start || 0, end: +w.end || 0, word });
    }
  }
  return out;
}

// content keywords from the narration itself (scenes.keywords can be noisy — recompute):
// prefer 2-word compounds ("bối cảnh", "kết quả"), fall back to single content words.
function contentKeywords(text, n = 6) {
  const toks = (fold(text).match(/[\p{L}\p{N}]+/gu) || []);
  const bi = {}, uni = {};
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w.length >= 3 && !STOP.has(w)) uni[w] = (uni[w] || 0) + 1;
    const w2 = toks[i + 1];
    if (w2 && !STOP.has(w) && !STOP.has(w2) && w.length >= 2 && w2.length >= 2) bi[w + ' ' + w2] = (bi[w + ' ' + w2] || 0) + 1;
  }
  const out = [];
  const used = new Set();
  for (const [b] of Object.entries(bi).sort((a, c) => c[1] - a[1])) {
    if (out.length >= n) break;
    const [x, y] = b.split(' ');
    if (used.has(x) || used.has(y)) continue;
    out.push(b); used.add(x); used.add(y);
  }
  for (const [u] of Object.entries(uni).sort((a, c) => c[1] - a[1])) {
    if (out.length >= n) break;
    if (!out.some((b) => b.includes(u))) out.push(u);
  }
  return out;
}

const MIN_GAP = 1.2;   // s between beat starts
const HOLD_MAX = 2.6;  // s a beat may stay on screen
const LEAD = 0.12;     // element lands slightly before the word is fully spoken

/**
 * srtJson: [{start,end,text,words:[{start,end,word}]}] — scene-local seconds
 * keywords: scenes.keywords (optional; merged with recomputed content keywords)
 * duration: scene duration in seconds
 */
export function extractBeats(srtJson, keywords, duration, { max = 5, min = 2 } = {}) {
  const words = flatWords(srtJson);
  const dur = Math.max(1.5, +duration || 6);
  if (!words.length) {
    // no timing at all → single centered phrase beat so the scene still breathes
    return [{ t0: Math.min(0.6, dur * 0.15), t1: Math.min(dur - 0.3, dur * 0.75), text: '', kind: 'phrase' }];
  }
  const foldedSeq = words.map((w) => fold(w.word).replace(/[^\p{L}\p{N}%]/gu, ''));
  const claimed = new Array(words.length).fill(false);
  const found = [];

  // 1) numbers & percentages — strongest visual hooks
  for (let i = 0; i < words.length; i++) {
    if (/^\d/.test(foldedSeq[i]) || /%$/.test(foldedSeq[i])) {
      // absorb a unit word after the number ("87 %", "10 lần", "5 phút")
      const next = words[i + 1] ? fold(words[i + 1].word) : '';
      const span = /^(%|lan|phut|giay|ty|trieu|nghin|ngan|nam|usd|dong|percent|times|x)$/.test(next) ? 2 : 1;
      found.push({ i, span, kind: 'number' });
      i += span - 1;
    }
  }

  // 2) keyword matches (provided + recomputed), bigrams first
  const text = words.map((w) => w.word).join(' ');
  const kws = [...new Set([...(Array.isArray(keywords) ? keywords : []), ...contentKeywords(text)]
    .map((k) => fold(String(k)).trim()).filter((k) => k && k.length >= 3 && !STOP.has(k)))];
  kws.sort((a, b) => (b.includes(' ') ? 1 : 0) - (a.includes(' ') ? 1 : 0) || b.length - a.length);
  const clauseBreak = (i) => /[.,;:?!…]\s*$/.test(words[i].word); // bigram must not span a clause boundary
  for (const kw of kws) {
    const parts = kw.split(/\s+/);
    for (let i = 0; i <= words.length - parts.length; i++) {
      if (claimed[i]) continue;
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        if (foldedSeq[i + j] !== parts[j] || (j < parts.length - 1 && clauseBreak(i + j))) { ok = false; break; }
      }
      if (ok) { found.push({ i, span: parts.length, kind: 'keyword' }); for (let j = 0; j < parts.length; j++) claimed[i + j] = true; break; }
    }
  }

  // order by time, enforce spacing, cap count
  found.sort((a, b) => words[a.i].start - words[b.i].start);
  const beats = [];
  for (const f of found) {
    const w0 = words[f.i], w1 = words[f.i + f.span - 1];
    const t0 = Math.max(0.15, w0.start - LEAD);
    if (beats.length && t0 - beats[beats.length - 1].t0 < MIN_GAP) {
      // numbers may evict a too-close keyword beat, never the other way around
      const prev = beats[beats.length - 1];
      if (f.kind === 'number' && prev.kind === 'keyword' && t0 > prev.t0) beats.pop(); else continue;
    }
    const label = words.slice(f.i, f.i + f.span).map((w) => w.word).join(' ')
      .replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}%]+$/u, '');
    if (!label || (f.kind === 'keyword' && STOP.has(fold(label)))) continue;
    beats.push({ t0, tEnd: w1.end, text: label, kind: f.kind });
    if (beats.length >= max) break;
  }

  // too few → phrase beat from the longest cue not already covered
  if (beats.length < min) {
    const cues = (Array.isArray(srtJson) ? srtJson : []).slice()
      .sort((a, b) => String(b.text || '').length - String(a.text || '').length);
    for (const cue of cues) {
      if (beats.length >= min) break;
      const t0 = Math.max(0.15, (+cue.start || 0) - LEAD);
      if (beats.some((b) => Math.abs(b.t0 - t0) < MIN_GAP)) continue;
      // keep only real content words — a cue of "..." must not become an on-screen "..." beat
      const short = String(cue.text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 5).join(' ')
        .replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}%]+$/u, '');
      if (!short) continue;
      beats.push({ t0, tEnd: +cue.end || t0 + 1.5, text: short, kind: 'phrase' });
    }
    beats.sort((a, b) => a.t0 - b.t0);
  }

  // close each beat: gone before the next one starts, bounded hold, inside the scene. Drop any
  // beat with empty text (pure punctuation stripped) or a window too small to read (< 0.4s).
  for (let i = 0; i < beats.length; i++) {
    const next = beats[i + 1];
    const cap = Math.min(dur - 0.05, next ? next.t0 - 0.15 : dur - 0.2);
    const t0 = +beats[i].t0.toFixed(3);
    const t1 = +Math.min(cap, Math.max(beats[i].tEnd + 0.5, t0 + 0.9), t0 + HOLD_MAX).toFixed(3);
    beats[i].t0 = t0; beats[i].t1 = t1;
    delete beats[i].tEnd;
    if (!String(beats[i].text || '').trim() || t1 <= t0 + 0.4) { beats.splice(i, 1); i--; }
  }
  return beats;
}

// ---- cinematic direction (per-scene energy classifier, vi + en) ----
const HIGH = /bùng nổ|tăng vọt|đột phá|bứt phá|kỷ lục|cực kỳ|khủng khiếp|siêu|kinh ngạc|chưa từng|gấp \d+|nhân \d+|x\d+|thần tốc|chóng mặt|shock|sốc|explode|skyrocket|record|insane|massive|all.time|breakthrough|pump|moon/i;
const DRAMATIC = /cảnh báo|nguy hiểm|rủi ro|sập|sụp đổ|mất trắng|lừa đảo|bẫy|khủng hoảng|đáng sợ|hậu quả|sai lầm|thất bại|scam|crash|warning|danger|risk|collapse|mistake|fail/i;
const LOW = /giải thích|cách |tại sao|để hiểu|cơ bản|đầu tiên|bước |khái niệm|ví dụ|nghĩa là|đơn giản|hãy tưởng tượng|kết quả|khám phá|ý tưởng|phân tích|so sánh|thảo luận|tìm hiểu|lưu ý|ghi nhớ|how to|why |basic|step |example|imagine|explain|analyze|compare|discover|note that/i;

export function cinematicDirection(scene, idx, total) {
  const text = `${scene.voice_text || ''} ${scene.visual_prompt || ''}`;
  const wc = (String(scene.voice_text || '').match(/[\p{L}\p{N}]+/gu) || []).length;
  const rate = wc / Math.max(2, +scene.duration || 6); // words/second
  const isHook = idx === 0;
  const isClimax = total > 2 && idx === total - 1;
  let energy = 'steady', mood = 'cinematic';
  if (HIGH.test(text)) { energy = 'high'; mood = 'epic'; }
  else if (DRAMATIC.test(text)) { energy = 'dramatic'; mood = 'tension'; }
  else if (LOW.test(text)) { energy = 'low'; mood = 'clean'; }
  if (isHook && energy === 'steady') { energy = 'high'; mood = 'epic'; }
  // the closing scene should land with weight even if its words are neutral
  if (isClimax && energy !== 'high' && energy !== 'dramatic') { energy = 'dramatic'; mood = 'tension'; }
  const pacing = energy === 'high' || rate > 3.1 ? 'fast' : energy === 'low' && rate < 2.3 ? 'slow' : 'medium';
  const camera = isHook ? 'push_in'
    : energy === 'high' ? 'aggressive_zoom'
      : energy === 'dramatic' ? 'dramatic_pan'
        : energy === 'low' ? 'slow_pan' : 'subtle_zoom';
  const transition = energy === 'high' ? 'flash' : energy === 'dramatic' ? 'glitch' : energy === 'low' ? 'smooth' : 'fade';
  return { pacing, energy, mood, camera, transition, isClimax, isHook };
}

// compact human-readable block for the codegen prompt
export function directionBlock(d) {
  return [
    `• Pacing: ${d.pacing} | Energy: ${d.energy} | Mood: ${d.mood}`,
    `• Camera: ${d.camera} | Transition-in: ${d.transition}`,
    `• Hook scene: ${d.isHook ? 'YES — open strong, biggest element of the video' : 'no'} | Climax scene: ${d.isClimax ? 'YES — raise intensity, scale and glow' : 'no'}`,
  ].join('\n');
}

export function beatsBlock(beats, duration) {
  const lines = beats.map((b, i) =>
    `// Beat ${i + 1}: ${b.t0.toFixed(2)}s → ${b.t1.toFixed(2)}s | kind=${b.kind} | "${b.text}"`);
  return [
    `// DUR = ${(+duration).toFixed(3)} seconds (total scene duration from the voice timeline)`,
    ...lines,
  ].join('\n');
}
