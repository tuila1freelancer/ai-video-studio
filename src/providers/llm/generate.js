// The legacy LLM script writers (single-call, verbatim and two-stage) and keyword extraction.
import { safeJson } from '../../util/util.js';
import { LANG_NAME } from '../../util/lang.js';
import { logger } from '../../util/log.js';
import { phrase, chapterLabel } from '../../i18n/script-phrases.js';

import { connectorList, voiceNoteFor, llmEnabled, chat } from './transport.js';
import { chatJson } from './json.js';
import { splitSentences, topNouns, offlineScript } from './script.js';
import { LANG_WPS, scriptLang, wordsForSlot, wordBudgetNote, scriptBudgetOk, bibleBlock } from './budget.js';

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
  // user's words verbatim (never rewritten, never compressed to a target length); the
  // video's duration follows the content. The LLM only decorates (title/visuals/keywords).
  // Too little text to be a real script → fall through to target mode.
  if (config.durationMode === 'auto' && sourceText.trim().split(/\s+/).filter(Boolean).length >= 80) {
    return verbatimScript(sourceText, { title, wordsPerScene, language, llm });
  }

  // assistant-accepted topics carry the angle the user approved — the script must honor it
  const angleLine = config.assistantBrief?.angle ? `\nMANDATORY angle for this video: ${config.assistantBrief.angle}` : '';

  // 2) LLM path — two-stage for long videos (outline → detailed chapters), single call for short.
  if (llmEnabled(llm)) {
    try {
      if (videoDuration >= 180) {
        return await twoStageScript({ sourceText, title, sceneCount, wordsPerScene, videoDuration, language, llm, memory, angleLine });
      }
      // soft scene-count range: the CONTENT decides the count, the prompt only nudges toward
      // the duration target. The hard >=70% floor (P4) still lives on the validate below.
      const minS = Math.max(1, Math.round(sceneCount * 0.75));
      const maxS = Math.max(minS + 1, Math.round(sceneCount * 1.25));
      const sys = 'You are a scriptwriter and motion designer for premium motion-graphics videos. Reply with pure JSON.';
      const hfVisualRules = `
Requirements for "visualPrompt" — a BRIEF for one premium animated INFOGRAPHIC scene (think motion designer, NOT a static website). Follow this exact frame, concise, 3-5 sentences:
[MAIN OBJECT] one meaning-bearing hero graphic filling ~60% of the frame (e.g. an answer card with mock bullets; a node chain Assumption→Evidence→Conclusion lighting up in turn; sticky notes clustering into a workflow; a scanner line sweeping a card; a big stat with a rising line/bar) — built from SVG/divs + line-art icons.
[ON-SCREEN TEXT] 1 short headline of 2-4 words + 2-3 short labels, CHOSEN BY MEANING (never paste the voice line), in the SAME LANGUAGE as the narration (${LANG_NAME[language] || language} narration → ${LANG_NAME[language] || language} text).
[MOTION] entry → reveal part by part following the order of ideas in the voice line (beat-synced) → hold → soft exit. [MOOD] 1-2 words.
VARIETY: NEVER repeat the same MAIN OBJECT type in 2 consecutive scenes (rotate: card / node-chain / big stat / list / split-compare / scanner…).
CONTINUITY: the scenes share ONE evolving visual language (a consistent accent logic + a carried motif) so cuts feel smooth — vary the composition every scene, keep the language continuous.
FORBIDDEN: "display text", static layouts, vague descriptions, invented copy, mixing English text into a non-English video.`;
      const usr = `Write a video script from the content below. First PLAN the whole talk, then write it, then break it into scenes. Output JSON shaped {"title":"...","throughline":"ONE sentence: the single argument this whole video makes (an argument, not a topic)","spine":["step 1 = the exact situation/gap to open on","step 2 that DEPENDS ON step 1","…","final step = the payoff that resolves the opening gap"],"scenes":[{"voice":"the spoken narration line","visualPrompt":"cinematic motion-graphics description in English","keywords":["..."]}]}.
PLAN THEN WRITE (fill the JSON in THIS order — the plan is written BEFORE the scenes on purpose):
1) "throughline": decide the ONE sentence this whole video argues.
2) "spine": the ordered logical steps that prove it — open on the exact situation/gap, each step BUILDS ON and advances the one before it, end on the step that resolves the opening gap. Enough steps to fill ${videoDuration}s, no filler steps.
3) "scenes": now render that spine as ONE continuous talk — one person developing one idea from start to finish — and CUT it into about ${sceneCount} scenes at natural idea boundaries. A scene is a SLICE of that one talk, never a standalone tip; scene N+1 must pick up exactly where scene N ended.
DURATION SHAPE: about ${sceneCount} scenes for a ${videoDuration}s video — ${minS}–${maxS} is all fine, let the CONTENT set the count (never pad with filler to hit a number, never cram two ideas into one scene). ${wordBudgetNote(wordsPerScene, wps)} — treat this as the SIZE of each slice when you segment, NOT a rule to make each scene self-contained. Vary the rhythm: a few short punchy scenes, most standard, a couple longer to land a concrete example. Target ~${sceneCount * wordsPerScene} words of narration total so the video fits ${videoDuration}s.
VALUE ARCHITECTURE (most important — this is the reason someone keeps watching):
- Every scene must TEACH one concrete, true, non-obvious thing from the source: state the claim, then the WHY/HOW, then ONE specific named example (an exact phrasing, a setting, a step, a before→after) that ALSO moves the through-line one step forward — not a self-contained tip. A scene that is only setup, only a transition, or only a rhetorical question is a FAILED scene.
- Be specific, not general — name the exact thing. "Add 'explain it as if I am a complete beginner' to the end of your prompt" beats "write a better prompt".
- Ground every figure in the source: use a number ONLY if it appears in the provided content — NEVER invent a statistic, percentage, or count. A precise verb beats a fake number.
- CONNECT scenes by LOGIC, not by filler: each scene CONTINUES the previous one — build on it, complicate it, or draw its consequence — joined by a forward logical connector (${connectorList(language)}), NEVER a tease-question. Read end to end, the scenes must sound like ONE unbroken talk, not numbered separate tips; do NOT restart a new topic each scene. Do NOT end scenes with throwaway questions or empty teases (${phrase(language, 'teases')}). At most ONE genuine viewer-directed question in the WHOLE video, and never two scenes in a row ending with "?".
FLOW:
- Scene 1: open cold and concrete — name the exact situation/gap the through-line will resolve and the specific, real payoff of this video (no greetings, no hyped fake numbers).
- Middle scenes: each takes the SAME argument one dependent step further with its own concrete example; momentum comes from the idea deepening, never from asking questions.
- Final scene: resolve the exact gap opened in Scene 1 as the single clearest takeaway, plus one natural line to subscribe.
Natural conversational tone. ${voiceNoteFor(language)} ALL narration written in ${LANG_NAME[language] || language}.
"keywords": 2-4 words/phrases present VERBATIM in THIS scene's "voice" — pick the strongest ones (numbers, power nouns); the graphics will emphasize these words AT THE EXACT MOMENT they are spoken, so a wrong pick desyncs visuals from audio.${hfVisualRules}${bibleBlock(memory)}${angleLine}
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
    } catch (e) { logger.warn(`LLM script failed, falling back to the offline writer: ${e.message}`); }
  }

  // 3) offline deterministic (with chapter structure for long videos)
  const off = offlineScript(sourceText, { title, sceneCount, wordsPerScene, structure: videoDuration >= 240, language });
  // Honor the ordered duration offline too: a long source must not balloon the scene count
  // (auto mode is the verbatim path — reaching here means the user asked for a TARGET).
  if (off.scenes.length > sceneCount * 1.25) off.scenes = off.scenes.slice(0, Math.max(1, Math.round(sceneCount * 1.25)));
  return off;
}

// Auto-duration verbatim mode: sentence-pack the user's script into scenes WITHOUT touching
// a single word, then (LLM on) one bounded decoration pass for title/visualPrompt/keywords.
// Decoration failure degrades to the offline heuristics — the user's text always survives.
async function verbatimScript(sourceText, { title, wordsPerScene, language, llm }) {
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
        { role: 'system', content: 'You are a motion designer for premium motion-graphics videos. Reply with pure JSON.' },
        { role: 'user', content: `The script below is the channel owner's VERBATIM text — you must NOT rewrite a single word of the narration. Produce only the decoration. Output JSON {"title":"click-worthy title ≤60 chars in ${LANG_NAME[language] || language}","scenes":[{"idx":scene number (1-based),"visualPrompt":"motion-graphics brief in English following the [MAIN OBJECT]/[ON-SCREEN TEXT]/[MOTION]/[MOOD] frame","keywords":["that scene's 2-4 strongest VERBATIM words"]}]} — every element MUST carry the exact "idx" of the scene it describes. Never repeat the same layout style in 2 consecutive scenes. On-screen text in the SAME LANGUAGE as the narration (${LANG_NAME[language] || language}).
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
  const persona = ` ${voiceNoteFor(language)}`;
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
      template: 'chapter-break', props: { chapter: chapterLabel(language, i + 1), heading: String(ch.heading || '').slice(0, 40) },
    });
    try {
      const det = await chatJson([
        { role: 'system', content: 'You are a captivating storyteller. Reply with pure JSON.' },
        { role: 'user', content: `Video "${outline.title || title}" (narration in ${LANG_NAME[language] || language}), chapter ${i + 1}/${chapters.length}: "${ch.heading}".${outline.throughline ? `\nThe whole video argues: "${outline.throughline}" — advance THIS argument, do not drift.` : ''}
Points that must all be covered: ${(ch.points || []).join('; ')}.${prevTail ? `\nThe CLOSING narration of the previous chapter (for continuity — CONTINUE this thread, do NOT repeat ideas already said): "…${prevTail}"` : ''}
Write detailed narration as ONE continuous talk — each scene CONTINUES the previous one (build on it, complicate it, or draw its consequence) via a forward connector (${connectorList(language)}), never a tease-question; scene N+1 picks up where scene N ended. Each scene teaches ONE concrete, non-obvious thing with a specific named example the viewer can copy; do NOT invent statistics. Never restate the chapter heading.${persona}
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
      const chScenes = offlineScript(body, { title, sceneCount: perCh, wordsPerScene, language }).scenes;
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
