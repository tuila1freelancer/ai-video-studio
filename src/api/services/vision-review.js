// A second pair of eyes on the finished video — a model's, not a person's.
//
// Every other check in the verdict is deterministic, and that is their limit: they can prove a clip
// exists, matches its design and is as long as the voice, but not that the frame is legible, that
// the title is not sitting on the subject, that the whole thing looks like the channel. That is
// what a person was for, and it is the last thing standing between an unattended run and publishing.
//
// OFF by default. It costs a paid call per video and needs a multimodal model, so a channel turns
// it on deliberately. It scores; it never edits, and a failure to score is not a defect in the video.
import { readFileSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { chatJson, llmEnabled } from '../../providers/llm.js';
import { buildContactSheet } from './contact-sheet.js';
import { logger } from '../../util/log.js';

/** @param {object} config @returns {{enabled:boolean, model:string|null, minScore:number, focus:string}} */
export function visionSettings(config = {}) {
  const raw = config.visionReview || {};
  return {
    enabled: raw.enabled === true,
    model: raw.model || null,
    minScore: Math.min(10, Math.max(1, +raw.minScore || 6)),
    focus: String(raw.focus || '').slice(0, 300),
  };
}

const PROMPT = `You are reviewing frames from a finished motion-graphics video before it is published.
Judge what a viewer would see, not what the script intended. Score 1-10 where:
  1-3 unpublishable (text cut off or unreadable, empty/blank frames, overlapping elements, broken layout)
  4-6 publishable but flawed (cramped composition, inconsistent styling, weak hierarchy)
  7-10 clean and consistent
List only problems you can actually SEE, each naming the frame position (row,column).
Reply as pure JSON: {"score":7,"summary":"one sentence","issues":["row 2 col 3: headline is clipped"]}`;

/**
 * Score a finished project's frames. Returns null when the channel has not turned this on, when
 * there is no model for it, or when the call fails — never throws into the verdict.
 * @param {string} projectId @param {object} config @param {object|null} ai
 */
export async function visionReview(projectId, config = {}, ai = null) {
  const settings = visionSettings(config);
  if (!settings.enabled) return null;
  const llm = settings.model ? { ...(ai?.llm || DB.aiSettings().llm || {}), model: settings.model } : (ai?.llm || DB.aiSettings().llm);
  if (!llmEnabled(llm)) return null;
  const project = DB.getProject(projectId);
  const scenes = DB.getScenes(projectId);
  if (!project || !scenes.length) return null;
  try {
    const sheet = await buildContactSheet(project, scenes);
    const dataUri = `data:image/jpeg;base64,${readFileSync(sheet).toString('base64')}`;
    const narration = scenes.map((s, i) => `${i + 1}. ${String(s.voice_text || '').slice(0, 120)}`).join('\n').slice(0, 4000);
    const parsed = await chatJson([
      { role: 'system', content: 'You are a demanding video quality reviewer. Reply with pure JSON.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${PROMPT}${settings.focus ? `\nThe channel also asks you to watch for: ${settings.focus}` : ''}\n\nWhat the video says, scene by scene:\n${narration}` },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ], { llm, attempts: 1, temperature: 0.2, maxTokens: 700, validate: (p) => Number.isFinite(+p.score) });
    const score = Math.min(10, Math.max(1, Math.round(+parsed.score)));
    return {
      score,
      minScore: settings.minScore,
      ok: score >= settings.minScore,
      summary: String(parsed.summary || '').slice(0, 300),
      issues: (Array.isArray(parsed.issues) ? parsed.issues : []).map((s) => String(s).slice(0, 200)).slice(0, 12),
      model: llm.model || null,
    };
  } catch (e) {
    // A review that could not run says so, and the verdict treats it as "not reviewed" — never as
    // a failing video. The deterministic checks are what decide publishable.
    logger.warn(`vision review: ${e.message}`, { projectId });
    return { score: null, minScore: settings.minScore, ok: null, error: e.message.slice(0, 200), issues: [] };
  }
}
