// The same video, in another language.
//
// One video, twelve markets. This is the cheapest reach the app has after subtitle tracks, and it
// is the reason most of the language work exists.
//
// What is REUSED is the expensive half: the art direction. Every scene's `visual_prompt` is the
// 8-bracket cinematic brief the direction pass wrote — layout archetype, camera, motion flow,
// lighting, mood — and the doctrine already keeps it in English precisely so it can drive a
// rendering engine that reads English. So the storyboard, the pacing, the palette, the style guide
// and the CTA plan all survive verbatim, and the video is recognisably the same video.
//
// What is REDONE is the half that is language: the narration, the voice, the captions, and the
// words on screen. On-screen text is regenerated rather than translated in place, because it lives
// inside a rendered HTML spec — and a spec whose headline was string-replaced would keep a box
// measured for Vietnamese around a German compound noun. B5 rebuilds it against the same brief.
import * as DB from '../db/index.js';
import { chatJson, llmEnabled, LANG_WPS } from '../providers/llm.js';
import { langName, resolveLang } from '../util/lang.js';
import { isSupported, lang as langRow } from '../i18n/languages.js';
import { countWords } from '../i18n/segment.js';
import { failed } from '../core/errors.js';

import { m, tp } from '../i18n/t.js';
const BATCH = 12;

/**
 * Translate narration scene by scene, keeping the count and the SPOKEN LENGTH.
 *
 * Length is the part a plain translation gets wrong. Vietnamese speaks 4.4 tokens a second and
 * English 2.6, so a faithful English rendering of a Vietnamese scene runs nearly twice as long as
 * its slot — and the slot is a visual that was designed around it. The target word count is
 * computed from both rates and given per scene.
 */
export async function translateNarration(scenes, { from, to, llm, onLog = () => {} } = {}) {
  if (!llmEnabled(llm)) throw failed('config.no-llm', m('cần bật LLM để dịch lời thoại'));
  const ratio = (LANG_WPS[to] || 3) / (LANG_WPS[from] || 3);
  const out = new Array(scenes.length);

  for (let i = 0; i < scenes.length; i += BATCH) {
    const slice = scenes.slice(i, i + BATCH);
    const asked = slice.map((sc, j) => ({
      id: String(i + j),
      words: Math.max(6, Math.round(countWords(sc.voice_text || '', from) * ratio)),
      text: String(sc.voice_text || ''),
    }));
    const reply = await chatJson([
      { role: 'system', content: `You re-write a video's narration from ${langName(from)} into ${langName(to)}.

This is a DUB, not a translation exercise. Each line is spoken over a scene that was designed
around it, so:
- Return a JSON object {"scenes":{"<id>":"<narration>"}} with EXACTLY the ids you were given.
- Hit the word count given for each line (±15%). It is not a style note: a line that runs long
  overruns the visual it belongs to, and one that runs short leaves it hanging in silence.
- Say what the line says, the way a native ${langName(to)} presenter would say it to camera — do
  not translate word by word, and do not add or remove an idea.
- Keep numbers, product names and proper nouns exactly.
- ${langRow(to).voiceNote || ''}
- Never add a greeting, a sign-off or a call to action that is not in the source line.` },
      { role: 'user', content: JSON.stringify({ scenes: asked }, null, 1) },
    ], {
      maxTokens: 600 + slice.length * 160,
      temperature: 0.35,
      llm,
      validate: (p) => p?.scenes && Object.keys(p.scenes).length === slice.length,
    });
    for (let j = 0; j < slice.length; j++) {
      const v = reply?.scenes?.[String(i + j)];
      if (typeof v !== 'string' || !v.trim()) throw new Error(tp`lồng tiếng: thiếu lời thoại cảnh ${i + j + 1}`);
      out[i + j] = v.trim();
    }
    onLog(tp`dịch lời thoại: ${Math.min(i + BATCH, scenes.length)}/${scenes.length} cảnh`);
  }
  return out;
}

/**
 * Clone a finished project into a new language.
 *
 * The clone is a normal project in every respect — it is started, resumed, reviewed and published
 * through the same pipeline as any other, and nothing here spends a credit. Actually running it is
 * the user's explicit click, like every other paid path in this app (P16).
 *
 * @returns {Promise<{project: object, scenes: number, language: string}>}
 */
export async function dubProject(sourceId, { language, llm, onLog = () => {} } = {}) {
  const src = DB.getProject(sourceId);
  if (!src) throw failed('config.bad-input', 'project not found');
  if (!isSupported(language)) throw failed('config.bad-input', m('ngôn ngữ không được hỗ trợ'));
  const srcScenes = DB.getScenes(sourceId).sort((a, b) => a.idx - b.idx);
  if (!srcScenes.length) throw failed('config.bad-input', m('dự án nguồn chưa có cảnh'));

  const from = resolveLang(src.config || {}, srcScenes);
  if (from === language) throw failed('config.bad-input', m('cần một ngôn ngữ KHÁC bản gốc'));

  const voices = await translateNarration(srcScenes, { from, to: language, llm, onLog });

  const config = { ...(src.config || {}), language };
  const project = DB.createProject({
    title: `${src.title} (${langName(language)})`.slice(0, 80),
    topic: src.topic,
    inputType: src.input_type,
    aspectRatio: src.aspect_ratio,
    config,
    channelId: src.channel_id,
  });
  DB.projectDirFor(project.id);

  // The art direction travels; the words do not. Dropping template/props is what makes B5 rebuild
  // the on-screen text in the new language against the SAME brief, so the design survives and the
  // language changes — and it leaves every clip to re-render, which it must anyway (P8).
  DB.replaceScenes(project.id, srcScenes.map((s, i) => ({
    voice: voices[i],
    visualPrompt: s.visual_prompt,
    keywords: [],
    template: null,
    props: null,
  })));

  onLog(tp`đã tạo bản ${langName(language)}: ${srcScenes.length} cảnh, giữ nguyên chỉ dẫn mỹ thuật`);
  return { project, scenes: srcScenes.length, language };
}
