// LLM sound design — reference-app parity (its prompt #95): ONE call reads the finished
// video's cue sheet (absolute SRT times) plus the owner's BGM/SFX library and returns a
// plan: one background track + SFX placed at meaningful moments. Everything is validated
// and clamped deterministically here; any failure (offline, bad JSON, empty library)
// returns null and the caller keeps the deterministic legacy behavior (ambient bed +
// chapter whooshes) — the lane only ever ADDS taste, never risk.
import { existsSync } from 'node:fs';
import { chat, llmEnabled } from '../providers/llm.js';
import { safeJson } from '../util/util.js';

export const BGM_VOL_MIN = 0.06, BGM_VOL_MAX = 0.18;   // pre-duck linear mix level bounds
export const SFX_VOL_MIN = 0.3, SFX_VOL_MAX = 1.0;     // per-event linear volume bounds
export const SFX_MIN_GAP_S = 1.0;                       // reference rule: no two SFX within 1s

/** Absolute cue sheet [{t, text}] from per-scene srt_json, on the FINAL timeline. */
export function buildCueSheet(scenes, lossBeforeScene = () => 0) {
  const out = [];
  let t = 0;
  scenes.forEach((s, k) => {
    const start = Math.max(0, t - lossBeforeScene(k));
    for (const cue of Array.isArray(s.srt_json) ? s.srt_json : []) {
      const at = +(start + (+cue.start || 0)).toFixed(2);
      const text = String(cue.text || '').trim();
      if (text) out.push({ t: at, text });
    }
    t += s.duration || 0;
  });
  return out;
}

/**
 * Validate + clamp a raw LLM plan against the real library and timeline.
 * Returns { bgmPath, bgmVol, events:[{at, src, gain}] } or null when nothing usable remains.
 * gain is dB relative to the SFX bed's fixed 0.75 mix (20*log10(vol/0.75)) so the plan's
 * linear volume lands as the effective level.
 */
export function sanitizePlan(raw, { bgm = [], sfx = [], total = 0 } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const byName = (list, name) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    return list.find((f) => f.name.toLowerCase() === n)
      || list.find((f) => f.name.toLowerCase().includes(n) || n.includes(f.name.toLowerCase()))
      || null;
  };
  const bgmPick = byName(bgm, raw.background_music);
  const bgmVol = Math.min(BGM_VOL_MAX, Math.max(BGM_VOL_MIN, +raw.background_volume || 0.12));
  const events = [];
  const list = Array.isArray(raw.sound_effects) ? raw.sound_effects : [];
  const sorted = list
    .map((e) => ({ pick: byName(sfx, e.file || e.name), at: +e.time, vol: +e.volume }))
    .filter((e) => e.pick && Number.isFinite(e.at) && e.at >= 0 && (!total || e.at < total - 0.3))
    .sort((a, b) => a.at - b.at);
  let lastAt = -Infinity;
  for (const e of sorted) {
    if (e.at - lastAt < SFX_MIN_GAP_S) continue; // reference rule: never stack SFX within 1s
    const vol = Math.min(SFX_VOL_MAX, Math.max(SFX_VOL_MIN, Number.isFinite(e.vol) ? e.vol : 0.7));
    events.push({ at: +e.at.toFixed(2), src: e.pick.path, gain: +(20 * Math.log10(vol / 0.75)).toFixed(1) });
    lastAt = e.at;
    if (events.length >= Math.min(40, Math.max(4, Math.floor((total || 60) / 5)))) break; // ≤ ~1 per 5s
  }
  if (!bgmPick && !events.length) return null;
  return { bgmPath: bgmPick ? bgmPick.path : null, bgmVol, events };
}

const SYS = `You are a sound designer for a short educational/social video. You receive the video's subtitle cue sheet (absolute seconds) and the available BGM + SFX libraries (file names describe their sound). Design the audio layer:
1. Pick EXACTLY ONE background music track whose mood fits the whole video (calm/ambient under narration).
2. Place sound effects at moments that deserve emphasis: topic transitions, key facts, numbers, warnings, punchlines, the ending. Use taste — a few well-placed effects beat many. Never two SFX within 1 second. Skip moments that need silence.
3. background_volume between 0.08 and 0.15 (music sits UNDER the voice). SFX volume 0.6–1.0.
Reply with ONLY this JSON: {"background_music":"<file name from the BGM list>","background_volume":0.12,"sound_effects":[{"file":"<file name from the SFX list>","time":<seconds>,"volume":0.8}]}`;

/**
 * One-call plan. Returns sanitized plan or null. Never throws.
 * @param {{scenes:any[], lossBeforeScene?:Function, bgm:{name,path}[], sfx:{name,path}[],
 *          total:number, title?:string, lang?:string, llm?:object, onLog?:Function}} opts
 */
export async function planSoundDesign({ scenes, lossBeforeScene, bgm = [], sfx = [], total = 0, title = '', lang = '', llm = null, onLog = () => {} }) {
  if (!llmEnabled(llm)) return null;
  if (!bgm.length && !sfx.length) return null;
  const cues = buildCueSheet(scenes, lossBeforeScene);
  if (!cues.length) return null;
  const sheet = cues.map((c) => `${c.t.toFixed(1)}s: ${c.text}`).join('\n').slice(0, 9000);
  const user = [
    `VIDEO: "${title}" (${lang || 'vi'}) — total ${Math.round(total)}s`,
    `BGM LIBRARY:\n${bgm.map((f) => `- ${f.name}`).join('\n') || '(none)'}`,
    `SFX LIBRARY:\n${sfx.slice(0, 120).map((f) => `- ${f.name}`).join('\n') || '(none)'}`,
    `CUE SHEET:\n${sheet}`,
  ].join('\n\n');
  try {
    const reply = await chat([
      { role: 'system', content: SYS },
      { role: 'user', content: user },
    ], { json: true, temperature: 0.4, maxTokens: 3000, llm });
    const plan = sanitizePlan(safeJson(reply, null), { bgm, sfx, total });
    if (plan) onLog(`sound design: ${plan.bgmPath ? 'BGM chosen' : 'no BGM'}, ${plan.events.length} SFX placed`);
    else onLog('sound design: plan unusable — keeping deterministic audio');
    return plan;
  } catch (e) {
    onLog(`sound design failed (${String(e.message).slice(0, 80)}) — keeping deterministic audio`);
    return null;
  }
}

/** Library files that exist on disk, name = display name without the upload prefix. */
export function usableLibrary(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.path && existsSync(r.path))
    .map((r) => ({ name: String(r.name || r.filename || '').trim() || String(r.filename || ''), path: r.path }));
}
