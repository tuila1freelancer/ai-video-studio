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
      if (!parsed) throw new Error('LLM returned invalid JSON');
      if (validate && !validate(parsed)) throw new Error('LLM JSON has wrong shape');
      return parsed;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---- Sentence splitting (Vietnamese + Latin aware) ----
export function splitSentences(text) {
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
        // spoken heading must be a WHOLE clause — never a mid-word slice(0,60) cut; the card's
        // short heading is derived on a word boundary from it.
        const firstSent = (splitSentences(p)[0] || p).trim();
        const head = firstSent.length > 90 ? firstSent.slice(0, 90).replace(/\s+\S*$/, '') : firstSent;
        const cardHeading = head.length > 40 ? head.slice(0, 40).replace(/\s+\S*$/, '') : head;
        scenes.push({
          voice: head, keywords: topNouns(p, 3), visualPrompt: head,
          template: 'chapter-break', props: { chapter: `PHẦN ${String(i + 1).padStart(2, '0')}`, heading: cardHeading },
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
export const LANG_WPS = { vi: 4.4, en: 2.6, ja: 3.4, ko: 3.1, zh: 3.4, ru: 2.4 };
const LANG_NAME = { vi: 'Vietnamese', en: 'English (US)', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian' };
function scriptLang(config, sourceText) {
  const c = String(config?.language || '').toLowerCase();
  if (c && c !== 'auto') return c;
  return detectLang(String(sourceText || '').slice(0, 400));
}
// THE canonical per-scene word budget. One formula shared by the script prompts, the
// editorial rewrite target, the duration-fit gate and the UI estimate — if these ever use
// different math, a fully compliant script audits as over/under and gets mangled.
// Model: a sceneDuration slot holds (slot − breath pad) seconds of SPEECH at the measured
// delivery rate (LANG_WPS budget × 0.95 spoken ratio — mirrors providers/subtitle.js).
export function wordsForSlot(sceneDuration, language) {
  const wps = LANG_WPS[language] || 3.0;
  const pad = language === 'vi' ? 0.65 : 0.4;
  return Math.max(8, Math.round((Math.max(2, sceneDuration) - pad) * wps * 0.95));
}

// The word-budget line every script prompt carries — scenes must FILL their time slot,
// and must never overflow it: overruns compound across scenes into a video far longer
// than the owner asked for (the duration-adherence gate then has to cut).
function wordBudgetNote(wordsPerScene, wps = 4.4) {
  return `each scene ${wordsPerScene - 3}–${wordsPerScene + 4} words, NO more (target ~${wordsPerScene}; TTS speaks ~${(+wps).toFixed(1)} words/second — write ENOUGH words, never stubby under ${wordsPerScene - 3}, never overflowing past ${wordsPerScene + 4}; ruthlessly cut every filler phrase like "as I said before", "well, actually"…)`;
}

const CJK_LANGS = new Set(['ja', 'zh']); // no whitespace word boundaries — word math is meaningless

// Soft budget validator for chatJson: only GROSS overruns re-ask (mean words/scene > 1.5×
// target) — a strict gate here would push good-but-chatty replies into the offline
// fallback; the deterministic budget-fit pass (stages/budget.js) owns fine trimming.
function scriptBudgetOk(scenes, wordsPerScene, language) {
  if (CJK_LANGS.has(language)) return true; // whitespace counting would misfire wildly
  const arr = (scenes || []).map((s) => String(s.voice || s.text || '')).filter(Boolean);
  if (!arr.length) return false;
  const mean = arr.reduce((a, v) => a + v.trim().split(/\s+/).filter(Boolean).length, 0) / arr.length;
  return mean <= wordsPerScene * 1.5;
}

// Additive Show-Bible block (channel persona + anti-repeat ledger). Purely appended to
// prompts — never restructures the JSON schema or touches the scene-count guard (P4).
function bibleBlock(memory) {
  if (!memory) return '';
  const lines = [];
  if ((memory.bible || '').trim()) lines.push(`CHANNEL CONTEXT (Show Bible — stay true to this identity, never read it aloud): ${memory.bible.trim().slice(0, 800)}`);
  const recent = (memory.topics || []).slice(-10).map((t) => t.t).filter(Boolean);
  if (recent.length) lines.push(`The channel's recent videos (do NOT repeat their content or angle): ${recent.join('; ')}`);
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
  const wordsPerScene = wordsForSlot(sceneDuration, language);

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

  // 1b) auto-duration mode: a DETAILED pasted/fetched script is the deliverable — keep the
  // owner's words verbatim (never rewritten, never compressed to a target length); the
  // video's duration follows the content. The LLM only decorates (title/visuals/keywords).
  // Too little text to be a real script → fall through to target mode.
  if (config.durationMode === 'auto' && sourceText.trim().split(/\s+/).filter(Boolean).length >= 80) {
    return verbatimScript(sourceText, {
      title, wordsPerScene, language, llm,
      hf: config.visualMode === 'hyperframe',
    });
  }

  // assistant-accepted topics carry the angle the owner approved — the script must honor it
  const angleLine = config.assistantBrief?.angle ? `\nMANDATORY angle for this video: ${config.assistantBrief.angle}` : '';

  // 2) LLM path — two-stage for long videos (outline → detailed chapters), single call for short.
  if (llmEnabled(llm)) {
    try {
      if (videoDuration >= 180) {
        return await twoStageScript({ sourceText, title, sceneCount, wordsPerScene, videoDuration, language, llm, memory, angleLine });
      }
      const hf = (config.visualMode === 'hyperframe');
      // soft scene-count range: the CONTENT decides the count, the prompt only nudges toward
      // the duration target. The hard >=70% floor (P4) still lives on the validate below.
      const minS = Math.max(1, Math.round(sceneCount * 0.75));
      const maxS = Math.max(minS + 1, Math.round(sceneCount * 1.25));
      const sys = hf
        ? 'You are a scriptwriter and motion designer for premium motion-graphics videos. Reply with pure JSON.'
        : 'You are a short-form video scriptwriter. Reply with pure JSON.';
      const hfVisualRules = `
Requirements for "visualPrompt" — a BRIEF for one premium animated INFOGRAPHIC scene (think motion designer, NOT a static website). Follow this exact frame, concise, 3-5 sentences:
[MAIN OBJECT] one meaning-bearing hero graphic filling ~60% of the frame (e.g. an answer card with mock bullets; a node chain Assumption→Evidence→Conclusion lighting up in turn; sticky notes clustering into a workflow; a scanner line sweeping a card; a big stat with a rising line/bar) — built from SVG/divs + line-art icons.
[ON-SCREEN TEXT] 1 short headline of 2-4 words + 2-3 short labels, CHOSEN BY MEANING (never paste the voice line), in the SAME LANGUAGE as the narration (Vietnamese narration → Vietnamese text).
[MOTION] entry → reveal part by part following the order of ideas in the voice line (beat-synced) → hold → soft exit. [MOOD] 1-2 words.
VARIETY: NEVER repeat the same MAIN OBJECT type in 2 consecutive scenes (rotate: card / node-chain / big stat / list / split-compare / scanner…).
CONTINUITY: the scenes share ONE evolving visual language (a consistent accent logic + a carried motif) so cuts feel smooth — vary the composition every scene, keep the language continuous.
FORBIDDEN: "display text", static layouts, vague descriptions, invented copy, mixing English text into a non-English video.`;
      const usr = `Write a video script from the content below. First PLAN the whole talk, then write it, then break it into scenes. Output JSON shaped {"title":"...","throughline":"ONE sentence: the single argument this whole video makes (an argument, not a topic)","spine":["step 1 = the exact situation/gap to open on","step 2 that DEPENDS ON step 1","…","final step = the payoff that resolves the opening gap"],"scenes":[{"voice":"the spoken narration line","visualPrompt":"${hf ? 'cinematic motion-graphics description in English' : 'visual description in English'}","keywords":["..."]}]}.
PLAN THEN WRITE (fill the JSON in THIS order — the plan is written BEFORE the scenes on purpose):
1) "throughline": decide the ONE sentence this whole video argues.
2) "spine": the ordered logical steps that prove it — open on the exact situation/gap, each step BUILDS ON and advances the one before it, end on the step that resolves the opening gap. Enough steps to fill ${videoDuration}s, no filler steps.
3) "scenes": now render that spine as ONE continuous talk — one person developing one idea from start to finish — and CUT it into about ${sceneCount} scenes at natural idea boundaries. A scene is a SLICE of that one talk, never a standalone tip; scene N+1 must pick up exactly where scene N ended.
DURATION SHAPE: about ${sceneCount} scenes for a ${videoDuration}s video — ${minS}–${maxS} is all fine, let the CONTENT set the count (never pad with filler to hit a number, never cram two ideas into one scene). ${wordBudgetNote(wordsPerScene, wps)} — treat this as the SIZE of each slice when you segment, NOT a rule to make each scene self-contained. Vary the rhythm: a few short punchy scenes, most standard, a couple longer to land a concrete example. Target ~${sceneCount * wordsPerScene} words of narration total so the video fits ${videoDuration}s.
VALUE ARCHITECTURE (most important — this is the reason someone keeps watching):
- Every scene must TEACH one concrete, true, non-obvious thing from the source: state the claim, then the WHY/HOW, then ONE specific named example (an exact phrasing, a setting, a step, a before→after) that ALSO moves the through-line one step forward — not a self-contained tip. A scene that is only setup, only a transition, or only a rhetorical question is a FAILED scene.
- Be specific, not general — name the exact thing. "Add 'giải thích như cho người mới bắt đầu' to the end of your prompt" beats "write a better prompt".
- Ground every figure in the source: use a number ONLY if it appears in the provided content — NEVER invent a statistic, percentage, or count. A precise verb beats a fake number.
- CONNECT scenes by LOGIC, not by filler: each scene CONTINUES the previous one — build on it, complicate it, or draw its consequence — joined by a forward logical connector (${language === 'vi' ? '"vì vậy…", "nhưng…", "vậy nên…", "và đây là lúc…"' : '"so…", "but that breaks when…", "which is why…"'}), NEVER a tease-question. Read end to end, the scenes must sound like ONE unbroken talk, not numbered separate tips; do NOT restart a new topic each scene. Do NOT end scenes with throwaway questions or empty teases ("còn bạn?", "muốn thử không?", "bạn biết chưa?", "điều bất ngờ ở phần sau…", "right?"). At most ONE genuine viewer-directed question in the WHOLE video, and never two scenes in a row ending with "?".
FLOW:
- Scene 1: open cold and concrete — name the exact situation/gap the through-line will resolve and the specific, real payoff of this video (no greetings, no hyped fake numbers).
- Middle scenes: each takes the SAME argument one dependent step further with its own concrete example; momentum comes from the idea deepening, never from asking questions.
- Final scene: resolve the exact gap opened in Scene 1 as the single clearest takeaway, plus one natural line to subscribe.
Natural conversational tone${language === 'vi' ? ', using the fixed Vietnamese forms of address "mình" (speaker) – "các bạn" (audience)' : ''}; ALL narration written in ${LANG_NAME[language] || language}.
"keywords": 2-4 words/phrases present VERBATIM in THIS scene's "voice" — pick the strongest ones (numbers, power nouns); the graphics will emphasize these words AT THE EXACT MOMENT they are spoken, so a wrong pick desyncs visuals from audio.${hf ? hfVisualRules : `
"visualPrompt" must illustrate THIS scene's specific idea (nothing generic), and never repeat the same layout style in 2 consecutive scenes.`}${bibleBlock(memory)}${angleLine}
Content:\n${sourceText.slice(0, 6000)}`;
      // enforce the scene count (≥70% of target) — lazy models love returning 2 scenes for a
      // 60s brief, which silently halves the video. chatJson re-asks once on validate failure.
      const minScenes = Math.max(1, Math.ceil(sceneCount * 0.7));
      const parsed = await chatJson([{ role: 'system', content: sys }, { role: 'user', content: usr }],
        { maxTokens: sceneCount * Math.max(130, wordsPerScene * 4) + 600 + sceneCount * 8, attempts: 3,
          validate: (p) => Array.isArray(p.scenes) && p.scenes.filter((s) => s.voice || s.text).length >= minScenes
            && scriptBudgetOk(p.scenes, wordsPerScene, language), llm });
      return { title: parsed.title || title, scenes: parsed.scenes.map((s) => ({
        voice: s.voice || s.text || '', visualPrompt: s.visualPrompt || s.visual || '', keywords: s.keywords || [],
      })).filter((s) => s.voice) };
    } catch (e) { /* fall through to offline */ }
  }

  // 3) offline deterministic (with chapter structure for long videos)
  const off = offlineScript(sourceText, { title, sceneCount, wordsPerScene, structure: videoDuration >= 240 });
  // Honor the ordered duration offline too: a long source must not balloon the scene count
  // (auto mode is the verbatim path — reaching here means the owner asked for a TARGET).
  if (off.scenes.length > sceneCount * 1.25) off.scenes = off.scenes.slice(0, Math.max(1, Math.round(sceneCount * 1.25)));
  return off;
}

// Auto-duration verbatim mode: sentence-pack the owner's script into scenes WITHOUT touching
// a single word, then (LLM on) one bounded decoration pass for title/visualPrompt/keywords.
// Decoration failure degrades to the offline heuristics — the owner's text always survives.
async function verbatimScript(sourceText, { title, wordsPerScene, language, llm, hf }) {
  // NOT splitSentences: its length>1 filter drops one-char fragments — verbatim mode must
  // preserve the paste exactly, so keep every non-empty piece.
  const sentences = String(sourceText || '').replace(/\s+/g, ' ')
    .split(/(?<=[.!?…。])\s+|(?<=[।。！？])/).map((x) => x.trim()).filter(Boolean);
  const scenes = [];
  let buf = [];
  let bufWords = 0;
  const flush = () => {
    if (!buf.length) return;
    const voice = buf.join(' ').trim();
    scenes.push({ voice, visualPrompt: voice.slice(0, 90), keywords: topNouns(voice, 3) });
    buf = []; bufWords = 0;
  };
  for (const sent of sentences) {
    const w = sent.trim().split(/\s+/).filter(Boolean).length;
    if (bufWords && bufWords + w > wordsPerScene + 5) flush();
    buf.push(sent.trim()); bufWords += w;
  }
  flush();
  if (!scenes.length) scenes.push({ voice: sourceText.trim().slice(0, 400), visualPrompt: sourceText.slice(0, 90), keywords: topNouns(sourceText, 3) });

  if (llmEnabled(llm)) {
    try {
      const MAX_DECOR = 40; // idx-addressed merge below makes partial coverage safe
      const listing = scenes.slice(0, MAX_DECOR).map((s, i) => `${i + 1}. ${s.voice.slice(0, 220)}`).join('\n');
      const deco = await chatJson([
        { role: 'system', content: hf
          ? 'You are a motion designer for premium motion-graphics videos. Reply with pure JSON.'
          : 'You are a video art director. Reply with pure JSON.' },
        { role: 'user', content: `The script below is the channel owner's VERBATIM text — you must NOT rewrite a single word of the narration. Produce only the decoration. Output JSON {"title":"click-worthy title ≤60 chars in ${LANG_NAME[language] || language}","scenes":[{"idx":scene number (1-based),"visualPrompt":"${hf ? 'motion-graphics brief in English following the [MAIN OBJECT]/[ON-SCREEN TEXT]/[MOTION]/[MOOD] frame' : 'visual description in English'}","keywords":["that scene's 2-4 strongest VERBATIM words"]}]} — every element MUST carry the exact "idx" of the scene it describes. Never repeat the same layout style in 2 consecutive scenes. On-screen text in the SAME LANGUAGE as the narration (${LANG_NAME[language] || language}).
Script:\n${listing.slice(0, 6500)}` },
      ], { maxTokens: scenes.length * 90 + 500, attempts: 2,
        validate: (p) => Array.isArray(p.scenes) && p.scenes.length >= Math.ceil(scenes.length * 0.6), llm });
      // idx-addressed: a skipped/short reply decorates only the scenes it names — visuals
      // can never shift onto the wrong narration.
      deco.scenes.forEach((d, i) => {
        const at = Number.isFinite(+d?.idx) ? (+d.idx | 0) - 1 : i;
        const sc = scenes[at];
        if (!sc) return;
        if (d?.visualPrompt) sc.visualPrompt = String(d.visualPrompt);
        if (Array.isArray(d?.keywords) && d.keywords.length) sc.keywords = d.keywords;
      });
      return { title: (deco.title || title).slice(0, 64), scenes };
    } catch { /* decoration is optional — verbatim scenes stand on their own */ }
  }
  return { title, scenes };
}

// Two-stage generation: (1) outline — pain→promise hook, chapters, mid-roll CTA, comment-bait
// CTA; (2) detailed narration per chapter, each chapter seeing the tail of the previous one so
// long videos never repeat themselves. Chapters that fail fall back to the offline splitter,
// so one bad LLM reply never sinks the whole script.
async function twoStageScript({ sourceText, title, sceneCount, wordsPerScene, videoDuration, language = 'vi', llm, memory = null, angleLine = '' }) {
  const nCh = Math.max(3, Math.min(8, Math.round(videoDuration / 150)));
  const langLine = `All narration written in ${LANG_NAME[language] || language}.${bibleBlock(memory)}${angleLine}`;
  const persona = language === 'vi' ? ' Use the fixed Vietnamese forms of address "mình" (speaker) – "các bạn" (audience).' : '';
  const outline = await chatJson([
    { role: 'system', content: 'You are a professional YouTube content director. Reply with pure JSON.' },
    { role: 'user', content: `Outline a ~${Math.round(videoDuration / 60)}-minute video from the content below. ${langLine}
Output JSON {"title":"click-worthy title ≤60 chars","throughline":"ONE sentence: the single argument the whole video makes (an argument, not a topic)","hook":"3-4 opening sentences: the first 1-2 name the exact situation/gap the throughline will resolve (concrete, relatable), then promise the specific, real payoff of watching to the end — start cold, no long greetings, never invent a number","chapters":[{"heading":"chapter name ≤40 chars","points":["key idea 1","key idea 2","..."]}],"ctaMid":"1-2 sentences inserted MID-video: a light reminder to save the video / subscribe so they don't miss what's next (natural, woven into the content, never abrupt)","cta":"2-3 closing sentences: resolve the exact gap opened in the hook + call to subscribe + ONE specific question inviting viewers to answer in the comments"} — exactly ${nCh} chapters, ORDERED so each chapter builds on the previous one to prove the throughline (not independent topics), 2-5 points each.
Content:\n${sourceText.slice(0, 7000)}` },
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
        { role: 'system', content: 'You are a captivating storyteller. Reply with pure JSON.' },
        { role: 'user', content: `Video "${outline.title || title}" (narration in ${LANG_NAME[language] || language}), chapter ${i + 1}/${chapters.length}: "${ch.heading}".${outline.throughline ? `\nThe whole video argues: "${outline.throughline}" — advance THIS argument, do not drift.` : ''}
Points that must all be covered: ${(ch.points || []).join('; ')}.${prevTail ? `\nThe CLOSING narration of the previous chapter (for continuity — CONTINUE this thread, do NOT repeat ideas already said): "…${prevTail}"` : ''}
Write detailed narration as ONE continuous talk — each scene CONTINUES the previous one (build on it, complicate it, or draw its consequence) via a forward connector (${language === 'vi' ? '"vì vậy…", "nhưng…", "vậy nên…"' : '"so…", "but…", "which is why…"'}), never a tease-question; scene N+1 picks up where scene N ended. Each scene teaches ONE concrete, non-obvious thing with a specific named example the viewer can copy; do NOT invent statistics. Never restate the chapter heading.${persona}
Output JSON {"scenes":[{"voice":"1-2 sentences"}]} — return about ${perCh} elements (let the content decide; ${Math.max(1, Math.ceil(perCh * 0.6))}–${perCh + 2} is fine), ${wordBudgetNote(wordsPerScene)}.` },
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
      const out = await chat([{ role: 'user', content: `Return JSON {"keywords":["..."]} with 6 English image-search keywords for the topic: ${topic}` }], { json: true });
      const p = safeJson(out, null);
      if (p && p.keywords) return p.keywords;
    } catch { /* ignore */ }
  }
  return topNouns(topic, 6);
}

// Metadata 2.0 — per-platform SEO through the robust chatJson machinery. The returned
// object keeps the OLD flat shape ({title, description, hashtags}) for every existing
// consumer, and adds `platforms` with the full per-platform payload + pinnedComment.
export async function generateMetadata(project, stylePrompt, { ai } = {}) {
  const llm = ai?.llm || null;
  const title = project?.title || project?.topic || 'Video';
  if (llmEnabled(llm)) {
    try {
      const p = await chatJson([
        { role: 'system', content: 'You are a YouTube/Shorts/TikTok SEO expert. Reply with pure JSON.' },
        { role: 'user', content: `${stylePrompt || ''}
Create multi-platform metadata for the video "${title}". Write every user-facing text (titles, descriptions, pinned comment) in the SAME LANGUAGE as that video title; tags/hashtags may mix in globally searched terms.
Output JSON:
{"youtube":{"title":"click-worthy ≤100 chars, MUST contain the topic's main keyword","description":"2-4 paragraphs; the first 2 lines carry the keywords (the part shown before 'show more'); end with 3-5 hashtags","tags":["10-15 search tags, no # prefix"],"pinnedComment":"1 pinned question inviting viewers to comment"},
"shorts":{"title":"≤60 chars","hashtags":["#shorts","#..."]},
"tiktok":{"title":"≤80 chars, hook-style","hashtags":["#..."]}}` },
      ], { attempts: 2, llm, validate: (x) => typeof x?.youtube?.title === 'string' && x.youtube.title.length > 3 });
      const yt = p.youtube;
      // keyword guard: the SEO title must still carry a content word of the real topic —
      // a clickbait rewrite that drops the topic entirely gets the topic prefixed back
      const kws = topNouns(title, 3);
      const flat = (s) => String(s || '').toLowerCase();
      let seoTitle = String(yt.title).slice(0, 100);
      if (kws.length && !kws.some((k) => flat(seoTitle).includes(flat(k)))) {
        seoTitle = `${title.slice(0, 60)} — ${seoTitle}`.slice(0, 100);
      }
      const hashtags = (p.shorts?.hashtags?.length ? p.shorts.hashtags : (yt.tags || []).map((t) => '#' + String(t).replace(/^#/, '').replace(/\s+/g, ''))).slice(0, 12);
      return {
        title: seoTitle,
        description: String(yt.description || ''),
        hashtags,
        pinnedComment: yt.pinnedComment || '',
        platforms: p,
      };
    } catch { /* fall through to offline */ }
  }
  const tags = topNouns(title, 8).map((w) => '#' + w.replace(/\s+/g, ''));
  return {
    title: `${title} | Bạn cần xem ngay!`,
    description: `${title}\n\nVideo được tạo tự động bằng AI Video Studio.`,
    hashtags: ['#fyp', '#viral', '#ai', ...tags].slice(0, 12),
  };
}
