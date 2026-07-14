// Scene planner — decides which motion template + props each scene gets.
// Offline heuristic always works; when an LLM key is configured, a single call
// plans the whole video and the heuristic backfills anything invalid.
import { chat, llmEnabled } from '../providers/llm.js';
import { TEMPLATES, ICON_NAMES } from './templates.js';
import { safeJson, wordCount } from '../util/util.js';
import { logger } from '../util/log.js';

const STOP = new Set(`the a an and or of to in on for with
là và của cho với trong đã sẽ được các những một này kia rằng khi bạn hãy có không thì mà nó vì nên bởi từ ra vào lên xuống
người việc điều cách rất cũng như nhiều hơn thứ nhất hai ba bốn năm sáu bảy tám chín mười luôn trước sau đang cần phải nếu để
dùng sử dụng làm giúp đây đó ấy vậy thật càng đều chỉ vẫn lại nữa mọi mỗi cùng theo về trên dưới giữa bằng hay còn thêm xong ngay`.split(/\s+/));

// Vietnamese-aware keywords: prefer 2-syllable compounds ("bối cảnh", "kết quả"),
// fall back to single content words.
function keywords(text, n = 4) {
  const toks = (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const biFreq = {}, uniFreq = {};
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w.length >= 3 && !STOP.has(w)) uniFreq[w] = (uniFreq[w] || 0) + 1;
    const w2 = toks[i + 1];
    if (w2 && !STOP.has(w) && !STOP.has(w2) && w.length >= 2 && w2.length >= 2) {
      const bg = w + ' ' + w2;
      biFreq[bg] = (biFreq[bg] || 0) + 1;
    }
  }
  const bis = Object.entries(biFreq).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const unis = Object.entries(uniFreq).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const out = [];
  const used = new Set();
  for (const b of bis) {
    if (out.length >= n) break;
    const [x, y] = b.split(' ');
    if (used.has(x) || used.has(y)) continue; // skip overlapping bigrams ("ai tóm"/"tóm tắt")
    out.push(b); used.add(x); used.add(y);
  }
  for (const u of unis) {
    if (out.length >= n) break;
    if (!out.some((b) => b.includes(u))) out.push(u);
  }
  return out;
}
// keywords good enough to display as big graphics
function displayKws(text, n = 3) {
  return keywords(text, n + 2).filter((k) => k.length >= 4).slice(0, n);
}

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

// JS \b is ASCII-only — patterns ending in diacritics ("bùng nổ", "đột phá") never match.
// Unicode-aware whole-word test instead.
function hasWord(text, alts) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function splitClauses(text) {
  return String(text || '').split(/[,;.]|(?:\s(?:và|hoặc|rồi|sau đó|tiếp theo|thứ \w+[,:]?)\s)/i)
    .map((x) => (x || '').trim()).filter((x) => x.length > 2);
}

const ROTATE = ['kinetic-statement', 'icon-focus', 'dual-keyword', 'split-cascade', 'number-highlight', 'terminal-scan', 'chat-demo'];
const ICON_POOL = ['bulb', 'target', 'bolt', 'rocket', 'brain', 'chart', 'clock', 'gear', 'shield', 'eye', 'doc', 'star'];

// Heuristic plan for a single scene. brand (optional) = resolved channel brand kit —
// injects the channel name into the hero label instead of the generic 'AI VIDEO'.
export function planScene(scene, { idx, total, title, brand }) {
  const text = scene.voice_text || '';
  const kws = keywords(text);
  const head = headline(text);
  const clauses = splitClauses(text);
  const numMatch = text.match(/\b(\d{1,2})\b/);
  const icon = ICON_POOL[(idx * 3 + text.length) % ICON_POOL.length];

  // first & last scenes have fixed roles
  if (idx === 0) {
    const heroHead = headline(title || text, 42);
    const rest = text.replace(/^[^.!?…]*[.!?…]?\s*/, '');
    const heroSub = headline(rest, 58);
    return { template: 'hero-title', props: {
      label: (brand?.channelName || 'AI VIDEO').toUpperCase(), heading: heroHead,
      sub: heroSub && heroSub !== heroHead ? heroSub : (displayKws(text, 3).join(' · ') || undefined),
      icon: 'bolt',
    } };
  }
  if (total > 3 && idx === total - 1) {
    return { template: 'kinetic-statement', props: { pre: 'TỔNG KẾT', heading: headline(text, 30), heading2: '', sub: displayKws(text, 3).join(' · ') } };
  }

  // ---- GSAP showcase rules (specific signals first) ----
  const pcts = [...text.matchAll(/(\d{1,3})\s*%/g)].map((m) => +m[1]).filter((v) => v > 0 && v <= 100);
  if (pcts.length >= 2 && clauses.length >= 2) {
    return { template: 'bar-race', props: { label: 'SỐ LIỆU', heading: head,
      items: clauses.slice(0, 4).map((c, i) => ({ title: headline(c.replace(/\d{1,3}\s*%/, '').trim(), 14) || `MỤC ${i + 1}`, value: pcts[i % pcts.length], suffix: '%' })).slice(0, Math.min(4, pcts.length)) } };
  }
  if (pcts.length === 1) {
    return { template: 'counter-stat', props: { label: kws[0] ? kws[0].toUpperCase() : 'CHỈ SỐ', value: pcts[0], unit: '%', heading: head, sub: headline(text.replace(/.*?\d{1,3}\s*%/, ''), 50) || undefined } };
  }
  if (hasWord(text, 'bùng nổ|tăng vọt|đột phá|bứt phá|kỷ lục|cực kỳ|thành công vượt|gấp \\d+ lần')) {
    return { template: 'physics-burst', props: { label: `PHẦN ${String(idx).padStart(2, '0')}`, heading: head, keyword: (displayKws(text, 1)[0] || headline(text, 12)).toUpperCase(), sub: undefined } };
  }
  if (hasWord(text, 'sơ đồ|cấu trúc|kết nối|liên kết|hệ thống|mô hình|thành phần') && clauses.length >= 2) {
    return { template: 'draw-diagram', props: { label: 'SƠ ĐỒ', heading: head, icon: ICON_POOL[idx % ICON_POOL.length],
      items: clauses.slice(0, 4).map((c, i) => ({ title: headline(c, 14), icon: ICON_POOL[(idx + i * 2) % ICON_POOL.length] })) } };
  }
  if (hasWord(text, 'bao gồm|gồm có|gồm|các loại|ví dụ như|chẳng hạn') && clauses.length >= 3) {
    const items = clauses.slice(0, 5).map((c) => ({ title: headline(c, 14) }));
    return idx % 2 === 0
      ? { template: 'orbit-3d', props: { label: 'TỔNG QUAN', heading: head, icon: ICON_POOL[idx % ICON_POOL.length], items } }
      : { template: 'mindmap-radial', props: { label: 'TỔNG QUAN', heading: head, icon: 'target', items } };
  }

  if (hasWord(text, 'bước|quy trình|giai đoạn|trình tự') && clauses.length >= 3) {
    return { template: 'timeline-steps', props: { label: 'QUY TRÌNH', heading: head, items: clauses.slice(0, 5).map((c, i) => ({ title: headline(c, 16), icon: ICON_POOL[(idx + i) % ICON_POOL.length] })) } };
  }
  if (hasWord(text, 'so sánh|khác nhau|khác biệt|hay là|thay vì|còn|trong khi') && clauses.length >= 2) {
    return { template: 'card-compare', props: { label: 'SO SÁNH', heading: head, items: clauses.slice(0, 3).map((c, i) => ({ title: headline(c, 18), sub: '', icon: ICON_POOL[(idx + i * 2) % ICON_POOL.length], tag: `MỤC ${i + 1}` })) } };
  }
  if (clauses.length >= 4) {
    return { template: 'list-reveal', props: { label: `PHẦN ${String(idx).padStart(2, '0')}`, heading: head, items: clauses.slice(0, 5).map((c) => ({ title: headline(c, 34) })) } };
  }
  if (numMatch && +numMatch[1] > 0) {
    return { template: 'number-highlight', props: { label: kws[0] ? kws[0].toUpperCase() : 'CON SỐ', number: +numMatch[1], heading: head, sub: headline(text.slice(text.indexOf(numMatch[0]) + numMatch[0].length), 50) || undefined } };
  }
  const dk = displayKws(text, 3);
  if (/\?/.test(text)) {
    return { template: 'icon-focus', props: { label: `PHẦN ${String(idx).padStart(2, '0')}`, icon: 'question', heading: head, chips: dk.length >= 2 ? dk : undefined } };
  }
  if (wordCount(text) <= 9 && dk.length >= 1) {
    return { template: 'split-cascade', props: { label: `PHẦN ${String(idx).padStart(2, '0')}`, heading: head, accentWord: dk[0], sub: undefined } };
  }
  if (dk.length >= 2 && wordCount(text) < 18 && idx % 3 === 2) {
    return { template: 'dual-keyword', props: { a: dk[0], b: dk[1], iconA: ICON_POOL[idx % ICON_POOL.length], iconB: ICON_POOL[(idx + 5) % ICON_POOL.length], sub: headline(text, 40) } };
  }

  // rotation fallback
  const tid = ROTATE[idx % ROTATE.length];
  if (tid === 'split-cascade' && dk.length >= 1) {
    return { template: 'split-cascade', props: { label: `PHẦN ${String(idx).padStart(2, '0')}`, heading: head, accentWord: dk[0], sub: dk.slice(1, 3).join(' · ') || undefined } };
  }
  if (tid === 'terminal-scan') {
    return { template: 'terminal-scan', props: { label: 'SYS.OP // ANALYSIS', heading: head, lines: ['> ' + headline(text, 42), '[SYS] analyzing…', '[SYS] context: OK', '[OK] ' + (dk[0] || 'insight')], tag: (dk[0] || '').toUpperCase() || undefined } };
  }
  if (tid === 'chat-demo' && dk.length >= 2) {
    return { template: 'chat-demo', props: { heading: head, messages: [ { from: 'user', text: headline(text, 60) }, { from: 'ai', text: 'Đã hiểu. Tôi sẽ xử lý: ' + dk.join(', ') + '.' } ] } };
  }
  if (tid === 'icon-focus') {
    return { template: 'icon-focus', props: { label: `PHẦN ${String(idx).padStart(2, '0')}`, icon, heading: head, chips: dk.length >= 2 ? dk : undefined } };
  }
  if (tid === 'dual-keyword' && dk.length >= 2) {
    return { template: 'dual-keyword', props: { a: dk[0], b: dk[1], sub: headline(text, 40) } };
  }
  if (tid === 'number-highlight') {
    return { template: 'number-highlight', props: { label: 'PHẦN', number: idx + 1, heading: head } };
  }
  const parts = head.split(/\s+/);
  const mid = Math.ceil(parts.length / 2);
  return { template: 'kinetic-statement', props: {
    pre: dk[0] ? dk[0].toUpperCase() : '', heading: parts.slice(0, mid).join(' '),
    heading2: parts.slice(mid).join(' '), sub: dk.slice(1, 3).join(' · ') || undefined,
  } };
}

// LLM plan for all scenes at once (optional upgrade).
async function llmPlan(scenes, title, llm) {
  const list = scenes.map((s, i) => `${i}: ${s.voice_text}`).join('\n');
  const tplDoc = Object.values(TEMPLATES).map((t) => `${t.id} — ${t.desc}`).join('\n');
  const out = await chat([
    { role: 'system', content: 'You are a motion designer. Reply with pure JSON.' },
    { role: 'user', content: `Video: "${title}". Pick a template + props for every scene (narration below).
Templates:\n${tplDoc}
Props per template: hero-title{label,heading,sub,icon} · kinetic-statement{pre,heading,heading2,sub} · number-highlight{label,number,heading,sub} · list-reveal{label,heading,items:[{title}]} · card-compare{label,heading,items:[{title,sub,icon,tag}]} · timeline-steps{label,heading,items:[{title,icon}]} · mindmap-radial{label,heading,icon,items:[{title}]} · chat-demo{heading,messages:[{from:'user'|'ai',text}]} · terminal-scan{label,heading,lines,tag} · icon-focus{label,icon,heading,sub,chips} · dual-keyword{a,b,iconA,iconB,sub} · rating-criteria{label,heading,sub,count} · chapter-break{chapter,heading} · cta-outro{heading,sub,cta} · split-cascade{label,heading,accentWord,sub} · counter-stat{label,value(0-100),unit('%'|'x'|''),heading,sub} · orbit-3d{label,heading,icon,items:[{title}]} · physics-burst{label,heading,keyword,sub} · draw-diagram{label,heading,icon,items:[{title,icon}]} · bar-race{label,heading,items:[{title,value(0-100),suffix}]}.
Valid icons: ${ICON_NAMES.join(', ')}.
Rules: scene 0 = hero-title; headings ≤ 38 chars, punchy, in the SAME LANGUAGE as the narration below; vary the templates; items ≤ 5.
Output JSON {"plan":[{"i":0,"template":"...","props":{...}}, ...]} with exactly ${scenes.length} elements.
Scenes:\n${list.slice(0, 7000)}` },
  ], { json: true, maxTokens: 4096, llm });
  const parsed = safeJson(out, null);
  if (!parsed || !Array.isArray(parsed.plan)) throw new Error('LLM plan invalid');
  return parsed.plan;
}

// Public: plan all scenes. Returns [{ template, props }] aligned to scenes order.
export async function planScenes(scenes, { title, brand, ai } = {}) {
  const total = scenes.length;
  const plans = scenes.map((s, idx) => planScene(s, { idx, total, title, brand }));
  if (llmEnabled(ai?.llm)) {
    try {
      const lp = await llmPlan(scenes, title, ai?.llm || null);
      for (const item of lp) {
        const i = item.i ?? item.index;
        if (i != null && plans[i] && item.template && TEMPLATES[item.template] && item.props) {
          plans[i] = { template: item.template, props: item.props };
        }
      }
      logger.info(`LLM scene plan applied (${lp.length} scenes)`);
    } catch (e) {
      logger.warn(`LLM plan failed (${e.message}); using heuristic`);
    }
  }
  return plans;
}
