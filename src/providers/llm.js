// LLM provider: OpenAI-compatible chat + script/metadata/keyword generation.
// Always degrades gracefully to a deterministic offline generator when no key is set.
import { aiSettings } from '../db/index.js';
import { wordCount, safeJson } from '../util/util.js';
import { detectLang } from '../util/lang.js';
import { recordUsage } from '../util/usage.js';

// llm param (optional) = a resolved settings.llm object (e.g. per-channel override);
// omitted → global settings, exactly as before.
export function llmEnabled(llm) {
  const s = llm || aiSettings().llm;
  return !!(s && s.enabled && s.apiKey && s.baseUrl);
}

// A dead-key error (bad auth / out of credit) — retrying the same key is pointless,
// rotate to the next one immediately. Transient errors back off and retry the same key.
const DEAD_KEY = /\b40[13]\b|invalid[_ ]?api[_ ]?key|incorrect api key|quota|credit|insufficient/i;

export async function chat(messages, { json = false, temperature = 0.8, maxTokens = 2048, timeoutMs = 120000, llm = null } = {}) {
  const s = llm || aiSettings().llm;
  if (!llmEnabled(s)) throw new Error('LLM not configured');
  // apiKey may hold SEVERAL keys (newline/comma-separated) — rotate through them; an optional
  // modelFallback is tried with every key after the primary model exhausts all keys.
  const keys = String(s.apiKey).split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean);
  const models = [s.model || 'gpt-4o-mini', ...(s.modelFallback && s.modelFallback !== s.model ? [String(s.modelFallback)] : [])];
  let lastErr;
  const RATE_LIMIT = /\b429\b|rate.?limit|too many requests/i;
  const RL_DELAYS = [8000, 20000, 45000];
  for (const model of models) {
    for (const apiKey of keys) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await chatOnce({ ...s, apiKey, model }, messages, { json, temperature, maxTokens, timeoutMs });
        } catch (e) {
          lastErr = e;
          const msg = String(e.message);
          // 429 first: a rate limit is NOT a dead key (even when the body mentions "quota") —
          // it clears with time, so back off long and retry the same key.
          if (RATE_LIMIT.test(msg)) {
            if (attempt < 3) { await new Promise((r) => setTimeout(r, RL_DELAYS[attempt])); continue; }
            break; // still limited after ~1min of backoff → next key/model
          }
          if (DEAD_KEY.test(msg)) break; // dead key → next key now
          if (attempt >= 1) break;       // other transient: 2 tries then move on
          await new Promise((r) => setTimeout(r, 1800));
        }
      }
    }
  }
  throw lastErr;
}

async function chatOnce(s, messages, { json, temperature, maxTokens, timeoutMs }) {
  // Reasoning models (gemini-*-low, o*, gpt-5*) burn max_tokens on hidden thinking BEFORE the
  // visible reply — a tight cap returns a truncated mid-thought fragment. Give every call a
  // generous floor (the reference app sends 100k for gemini-like backends); providers simply
  // stop earlier when done. Tune with llm.maxTokensFloor if a backend rejects large caps.
  const floor = Number(s.maxTokensFloor) > 0 ? Number(s.maxTokensFloor) : 16000;
  const body = {
    model: s.model || 'gpt-4o-mini', messages, temperature, max_tokens: Math.max(maxTokens, floor), stream: false,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  // users often paste the FULL endpoint as baseUrl — normalize so both forms work
  const base = s.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.usage) {
      recordUsage('llm', { model: body.model, promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens });
    }
    return data.choices?.[0]?.message?.content || '';
  } catch {
    // some proxies stream SSE regardless of stream:false — concatenate the delta chunks
    let out = '';
    let usage = null; // some backends attach usage to the final SSE chunk
    for (const line of text.split(/\n/)) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m || m[1] === '[DONE]') continue;
      try {
        const j = JSON.parse(m[1]);
        out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
        if (j.usage) usage = j.usage;
      } catch { /* partial keep-alive line */ }
    }
    if (!out) throw new Error(`LLM unparseable response: ${text.slice(0, 200)}`);
    if (usage) recordUsage('llm', { model: body.model, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
    return out;
  }
}

// ---- robust JSON chat: fence-strip + truncation repair + one cooler retry ----
function stripFences(s) {
  return String(s || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}
// Salvage truncated JSON by closing unbalanced strings/brackets.
function repairJson(s) {
  let out = '';
  let inStr = false, escp = false;
  const stack = [];
  for (const ch of String(s || '')) {
    out += ch;
    if (escp) { escp = false; continue; }
    if (ch === '\\') { if (inStr) escp = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}
export async function chatJson(messages, { maxTokens = 2048, attempts = 2, temperature = 0.7, validate = null, llm = null } = {}) {
  let lastErr;
  const s = llm || aiSettings().llm;
  // Gemini-like proxies choke on response_format:json_object (they reply with a bare fence).
  // Try JSON mode once, then fall back to plain replies — the prompts already demand pure
  // JSON and stripFences+repairJson clean up what comes back. jsonMode:false skips it outright.
  const preferJson = s?.jsonMode !== false;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await chat(messages, { json: preferJson && i === 0, maxTokens, temperature: i ? 0.4 : temperature, llm });
      const raw = stripFences(out);
      const parsed = safeJson(raw, null) ?? safeJson(repairJson(raw), null);
      if (!parsed) throw new Error('LLM trả về JSON không hợp lệ');
      if (validate && !validate(parsed)) throw new Error('LLM JSON sai cấu trúc');
      return parsed;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---- Sentence splitting (Vietnamese + Latin aware) ----
function splitSentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…。])\s+|(?<=[।。！？])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function topNouns(text, n = 4) {
  const stop = new Set('the a an and or but of to in on for with is are was were be this that những và của là một các cho với trong đã sẽ được'.split(' '));
  const freq = {};
  for (const w of (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])) {
    if (w.length < 4 || stop.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

// Build a script from arbitrary text, chunked to fit sceneCount scenes ~ wordsPerScene.
function offlineScript(sourceText, { title, sceneCount, wordsPerScene, structure = false }) {
  // Long-video structure without an LLM: paragraphs become chapters with a
  // chapter-break scene (narrated heading) so tens-of-minutes videos get an arc.
  if (structure && sceneCount >= 18) {
    const paras = String(sourceText || '').split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => wordCount(p) >= 12);
    if (paras.length >= 3) {
      const per = Math.max(2, Math.round((sceneCount - paras.length) / paras.length));
      const scenes = [];
      paras.forEach((p, i) => {
        const head = (splitSentences(p)[0] || p).slice(0, 60);
        scenes.push({
          voice: head, keywords: topNouns(p, 3), visualPrompt: head,
          template: 'chapter-break', props: { chapter: `PHẦN ${String(i + 1).padStart(2, '0')}`, heading: head.slice(0, 40) },
        });
        const sub = offlineScript(p, { title, sceneCount: per, wordsPerScene });
        scenes.push(...sub.scenes);
      });
      scenes.push({ voice: 'Nếu video hữu ích với bạn, hãy đăng ký kênh và bật chuông thông báo để không bỏ lỡ những phần tiếp theo nhé.', keywords: ['đăng ký'], visualPrompt: title });
      return { title, scenes };
    }
  }
  const sentences = splitSentences(sourceText);
  const scenes = [];
  if (!sentences.length) {
    // no usable text — fabricate evenly from the topic
    for (let i = 0; i < sceneCount; i++) {
      scenes.push({ voice: `${title}. Phần ${i + 1}.`, visualPrompt: title, keywords: topNouns(title, 3) });
    }
    return { title, scenes };
  }
  // distribute sentences across scenes targeting wordsPerScene
  let bucket = [];
  let bucketWords = 0;
  const flush = () => {
    if (!bucket.length) return;
    const voice = bucket.join(' ');
    scenes.push({ voice, visualPrompt: voice.slice(0, 90), keywords: topNouns(voice, 3) });
    bucket = []; bucketWords = 0;
  };
  for (const s of sentences) {
    bucket.push(s); bucketWords += wordCount(s);
    if (bucketWords >= wordsPerScene) flush();
  }
  flush();
  // pad or trim toward sceneCount when we have a hard duration target
  while (scenes.length < sceneCount && scenes.length > 0) {
    // split the longest scene into two
    let li = 0; for (let i = 1; i < scenes.length; i++) if (wordCount(scenes[i].voice) > wordCount(scenes[li].voice)) li = i;
    const parts = splitSentences(scenes[li].voice);
    if (parts.length < 2) break;
    const mid = Math.ceil(parts.length / 2);
    const a = parts.slice(0, mid).join(' '), b = parts.slice(mid).join(' ');
    scenes.splice(li, 1,
      { voice: a, visualPrompt: a.slice(0, 90), keywords: topNouns(a, 3) },
      { voice: b, visualPrompt: b.slice(0, 90), keywords: topNouns(b, 3) });
  }
  return { title, scenes };
}

// Spoken words(-as-written-tokens) per second by language — Vietnamese "words" are syllables,
// so neural voices land near the reference channel's ~270 syllables/min. Undershooting this
// (the old flat 2.6) produced scenes that ran seconds shorter than their slot.
const LANG_WPS = { vi: 4.4, en: 2.6, ja: 3.4, ko: 3.1, zh: 3.4, ru: 2.4 };
const LANG_NAME = { vi: 'tiếng Việt', en: 'English (US)', ja: '日本語', ko: '한국어', zh: '中文', ru: 'русский' };
function scriptLang(config, sourceText) {
  const c = String(config?.language || '').toLowerCase();
  if (c && c !== 'auto') return c;
  return detectLang(String(sourceText || '').slice(0, 400));
}
// The word-budget line every script prompt carries — scenes must FILL their time slot.
function wordBudgetNote(wordsPerScene) {
  return `mỗi cảnh ${wordsPerScene - 3}–${wordsPerScene + 5} từ (mục tiêu ~${wordsPerScene}; TTS đọc nhanh hơn bạn nghĩ — viết ĐỦ chữ, tuyệt đối không cụt ngủn dưới ${wordsPerScene - 3} từ)`;
}

// Additive Show-Bible block (channel persona + anti-repeat ledger). Purely appended to
// prompts — never restructures the JSON schema or touches the scene-count guard (P4).
function bibleBlock(memory) {
  if (!memory) return '';
  const lines = [];
  if ((memory.bible || '').trim()) lines.push(`BỐI CẢNH KÊNH (Show Bible — giữ đúng bản sắc, không đọc nguyên văn): ${memory.bible.trim().slice(0, 800)}`);
  const recent = (memory.topics || []).slice(-10).map((t) => t.t).filter(Boolean);
  if (recent.length) lines.push(`Các video gần đây của kênh (TRÁNH lặp lại nội dung/góc tiếp cận): ${recent.join('; ')}`);
  return lines.length ? `\n${lines.join('\n')}` : '';
}

// Public: generate a full script for a project.
// input: { topic, inputType, config, memory? (channel Show Bible) }
export async function generateScript({ topic, inputType, fetched, config, ai, memory = null }) {
  const llm = ai?.llm || null;
  const sceneDuration = config.sceneDuration || 7;
  const videoDuration = config.videoDuration || 60;
  const sceneCount = Math.max(1, Math.round(videoDuration / sceneDuration));
  const language = scriptLang(config, (fetched && fetched.text) || topic);
  const wps = LANG_WPS[language] || 3.0;
  const wordsPerScene = Math.max(10, Math.round(sceneDuration * wps));

  // 1) JSON script provided directly
  if (inputType === 'json') {
    const parsed = safeJson(topic, null);
    if (parsed) {
      const arr = Array.isArray(parsed) ? parsed : (parsed.scenes || []);
      const title = (parsed.title) || 'Kịch bản JSON';
      const scenes = arr.map((s) => ({
        voice: s.voice || s.text || s.narration || '',
        visualPrompt: s.visualPrompt || s.visual || s.image || (s.voice || '').slice(0, 90),
        keywords: s.keywords || [],
      })).filter((s) => s.voice);
      if (scenes.length) return { title, scenes };
    }
  }

  const sourceText = (fetched && fetched.text) ? fetched.text : topic;
  const firstSentence = (splitSentences(sourceText)[0] || sourceText.split('\n')[0] || topic).trim();
  const title = ((fetched && fetched.title) || (firstSentence.length > 6 ? firstSentence : topic) || 'Video mới').slice(0, 64);

  // 2) LLM path — two-stage for long videos (outline → detailed chapters), single call for short.
  if (llmEnabled(llm)) {
    try {
      if (videoDuration >= 180) {
        return await twoStageScript({ sourceText, title, sceneCount, wordsPerScene, videoDuration, language, llm, memory });
      }
      const hf = (config.visualMode === 'hyperframe');
      const sys = hf
        ? 'Bạn là biên kịch kiêm motion designer cho video đồ hoạ chuyển động cao cấp. Trả về JSON thuần.'
        : 'Bạn là biên kịch video ngắn. Trả về JSON thuần.';
      const hfVisualRules = `
Yêu cầu cho "visualPrompt" — mô tả BRIEF cho một cảnh INFOGRAPHIC chuyển động cao cấp (như motion designer, KHÔNG phải website tĩnh). Theo đúng khung sau, ngắn gọn 3-5 câu:
[MAIN OBJECT] một đồ hoạ chính hợp nghĩa chiếm ~60% khung (vd: answer card có bullet giả; chuỗi node Giả định→Bằng chứng→Kết luận sáng dần; sticky-notes gom thành workflow; scanner line quét qua card; stat lớn kèm đường/bar tăng) — vẽ bằng SVG/div + icon line-art.
[ON-SCREEN TEXT] 1 headline ngắn 2-4 từ + 2-3 nhãn ngắn, CHỌN THEO NGHĨA (không bê nguyên câu voice), ĐÚNG NGÔN NGỮ lời thoại (thoại tiếng Việt → chữ tiếng Việt).
[MOTION] entry → reveal từng phần theo thứ tự ý voice (beat-sync) → giữ → thoát nhẹ. [MOOD] 1-2 từ.
CẤM: "display text", layout tĩnh, mô tả mơ hồ, bịa chữ, chèn tiếng Anh vào video tiếng Việt.`;
      const usr = `Tạo kịch bản video từ nội dung sau. Xuất JSON dạng {"title":"...","scenes":[{"voice":"lời thoại đọc","visualPrompt":"${hf ? 'cinematic motion-graphics description in English' : 'mô tả hình ảnh tiếng Anh'}","keywords":["..."]}]}.
Yêu cầu: PHẢI tạo ĐÚNG ${sceneCount} cảnh (video ${videoDuration}s cần đủ ${sceneCount} cảnh — trả thiếu cảnh là sai đề bài), ${wordBudgetNote(wordsPerScene)}, giọng tự nhiên${language === 'vi' ? ', xưng hô cố định "mình – các bạn"' : ''}, toàn bộ lời thoại bằng ${LANG_NAME[language] || language}.
Cảnh mở đầu là HOOK theo công thức NỖI ĐAU → LỜI HỨA: 1-2 câu gọi đúng vấn đề người xem đang gặp, rồi hứa lợi ích cụ thể (có con số/khung thời gian) khi xem hết video. Cảnh cuối chốt giá trị + kêu gọi đăng ký + một câu hỏi cụ thể mời trả lời dưới comment.${hf ? hfVisualRules : ''}${bibleBlock(memory)}
Nội dung:\n${sourceText.slice(0, 6000)}`;
      // enforce the scene count (≥70% of target) — lazy models love returning 2 scenes for a
      // 60s brief, which silently halves the video. chatJson re-asks once on validate failure.
      const minScenes = Math.max(1, Math.ceil(sceneCount * 0.7));
      const parsed = await chatJson([{ role: 'system', content: sys }, { role: 'user', content: usr }],
        { maxTokens: sceneCount * Math.max(130, wordsPerScene * 4) + 600, attempts: 3,
          validate: (p) => Array.isArray(p.scenes) && p.scenes.filter((s) => s.voice || s.text).length >= minScenes, llm });
      return { title: parsed.title || title, scenes: parsed.scenes.map((s) => ({
        voice: s.voice || s.text || '', visualPrompt: s.visualPrompt || s.visual || '', keywords: s.keywords || [],
      })).filter((s) => s.voice) };
    } catch (e) { /* fall through to offline */ }
  }

  // 3) offline deterministic (with chapter structure for long videos)
  return offlineScript(sourceText, { title, sceneCount, wordsPerScene, structure: videoDuration >= 240 });
}

// Two-stage generation: (1) outline — pain→promise hook, chapters, mid-roll CTA, comment-bait
// CTA; (2) detailed narration per chapter, each chapter seeing the tail of the previous one so
// long videos never repeat themselves. Chapters that fail fall back to the offline splitter,
// so one bad LLM reply never sinks the whole script.
async function twoStageScript({ sourceText, title, sceneCount, wordsPerScene, videoDuration, language = 'vi', llm, memory = null }) {
  const nCh = Math.max(3, Math.min(8, Math.round(videoDuration / 150)));
  const langLine = `Toàn bộ lời thoại bằng ${LANG_NAME[language] || language}.${bibleBlock(memory)}`;
  const persona = language === 'vi' ? ' Xưng hô cố định "mình – các bạn".' : '';
  const outline = await chatJson([
    { role: 'system', content: 'Bạn là đạo diễn nội dung YouTube chuyên nghiệp. Trả về JSON thuần.' },
    { role: 'user', content: `Lập dàn ý video dài ~${Math.round(videoDuration / 60)} phút từ nội dung dưới. ${langLine}
Xuất JSON {"title":"tiêu đề giật tít ≤60 ký tự","hook":"mở đầu 3-4 câu theo công thức NỖI ĐAU → LỜI HỨA: 1-2 câu đầu gọi đúng vấn đề người xem đang gặp (cụ thể, đời thường), rồi hứa lợi ích cụ thể CÓ CON SỐ (vd '12 thói quen', '7 ngày') khi xem hết video — vào thẳng, không chào hỏi dài dòng","chapters":[{"heading":"tên chương ≤40 ký tự","points":["ý chính 1","ý chính 2","..."]}],"ctaMid":"1-2 câu chèn GIỮA video: nhắc nhẹ lưu video / đăng ký để không bỏ lỡ phần sau (tự nhiên, nối mạch nội dung, không sống sượng)","cta":"lời kết 2-3 câu: tóm giá trị + kêu gọi đăng ký + MỘT CÂU HỎI cụ thể mời người xem trả lời dưới comment (hứa đọc/dùng comment cho video sau)"} — đúng ${nCh} chương, mỗi chương 2-5 points.
Nội dung:\n${sourceText.slice(0, 7000)}` },
  ], { maxTokens: 2800, validate: (p) => p.hook && Array.isArray(p.chapters) && p.chapters.length > 0, llm });

  const chapters = outline.chapters.slice(0, 10);
  const overhead = 3 + chapters.length; // hook + ctaMid + cta + one chapter-break per chapter
  const perCh = Math.max(2, Math.round((sceneCount - overhead) / chapters.length));
  const scenes = [{ voice: outline.hook, keywords: topNouns(outline.hook, 3), visualPrompt: outline.hook.slice(0, 90) }];
  const midAt = Math.max(1, Math.round(chapters.length / 2)); // mid-roll CTA after this chapter
  let prevTail = ''; // last narration of the previous chapter — context so chapters never repeat

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    scenes.push({
      voice: ch.heading, keywords: topNouns(ch.heading, 3), visualPrompt: ch.heading,
      template: 'chapter-break', props: { chapter: `PHẦN ${String(i + 1).padStart(2, '0')}`, heading: String(ch.heading || '').slice(0, 40) },
    });
    try {
      const det = await chatJson([
        { role: 'system', content: 'Bạn là người kể chuyện cuốn hút. Trả về JSON thuần.' },
        { role: 'user', content: `Video "${outline.title || title}" (${LANG_NAME[language] || language}), chương ${i + 1}/${chapters.length}: "${ch.heading}".
Các ý cần phủ đủ: ${(ch.points || []).join('; ')}.${prevTail ? `\nLời thoại KẾT chương trước (để nối mạch — KHÔNG lặp lại ý đã nói): "…${prevTail}"` : ''}
Viết lời thoại chi tiết, tự nhiên như đang trò chuyện, có ví dụ cụ thể, không lặp tiêu đề chương.${persona}
Xuất JSON {"scenes":[{"voice":"1-2 câu"}]} — PHẢI trả ĐÚNG ${perCh} phần tử (thiếu là sai đề bài), ${wordBudgetNote(wordsPerScene)}.` },
      ], { maxTokens: perCh * Math.max(130, wordsPerScene * 4) + 400, attempts: 3,
        validate: (p) => Array.isArray(p.scenes) && p.scenes.filter((s) => s.voice || s.text).length >= Math.max(1, Math.ceil(perCh * 0.6)), llm });
      const chScenes = det.scenes.map((s) => ({
        voice: s.voice || s.text || '', visualPrompt: (s.voice || '').slice(0, 90), keywords: topNouns(s.voice || '', 3),
      })).filter((s) => s.voice);
      scenes.push(...chScenes);
      prevTail = chScenes.slice(-2).map((s) => s.voice).join(' ').slice(-240);
    } catch {
      // chapter-level degradation: offline-split this chapter's points
      const body = [ch.heading, ...(ch.points || [])].join('. ');
      const chScenes = offlineScript(body, { title, sceneCount: perCh, wordsPerScene }).scenes;
      scenes.push(...chScenes);
      prevTail = chScenes.slice(-2).map((s) => s.voice).join(' ').slice(-240);
    }
    if (i === midAt - 1 && (outline.ctaMid || '').trim().length >= 12) {
      scenes.push({ voice: outline.ctaMid.trim(), keywords: ['đăng ký'], visualPrompt: outline.ctaMid.trim().slice(0, 90) });
    }
  }
  scenes.push({ voice: outline.cta || 'Cảm ơn bạn đã xem. Đăng ký kênh để không bỏ lỡ video tiếp theo nhé!', keywords: ['đăng ký'], visualPrompt: title });
  return { title: (outline.title || title).slice(0, 64), scenes };
}

export async function generateKeywords(topic) {
  if (llmEnabled()) {
    try {
      const out = await chat([{ role: 'user', content: `Trả về JSON {"keywords":["..."]} gồm 6 từ khoá tìm ảnh (tiếng Anh) cho chủ đề: ${topic}` }], { json: true });
      const p = safeJson(out, null);
      if (p && p.keywords) return p.keywords;
    } catch { /* ignore */ }
  }
  return topNouns(topic, 6);
}

export async function generateMetadata(project, stylePrompt, { ai } = {}) {
  const llm = ai?.llm || null;
  const title = project?.title || project?.topic || 'Video';
  if (llmEnabled(llm)) {
    try {
      const out = await chat([
        { role: 'system', content: 'Trả về JSON thuần.' },
        { role: 'user', content: `${stylePrompt || 'Tạo metadata mạng xã hội.'}\nXuất JSON {"title":"","description":"","hashtags":["#..."]}. Chủ đề: ${title}` },
      ], { json: true, llm });
      const p = safeJson(out, null);
      if (p && p.title) return p;
    } catch { /* ignore */ }
  }
  const tags = topNouns(title, 8).map((w) => '#' + w.replace(/\s+/g, ''));
  return {
    title: `${title} | Bạn cần xem ngay!`,
    description: `${title}\n\nVideo được tạo tự động bằng AI Video Studio.`,
    hashtags: ['#fyp', '#viral', '#ai', ...tags].slice(0, 12),
  };
}
