// EDIT VIDEO (P40) — reference-app parity for "put motion graphics on a video I already have".
//
// The reference app's edit-video mode takes an existing file, transcribes it, cuts it into
// segments, has the model design an overlay for each, renders them on a key colour and
// composites them back onto the footage. This lane does the same by REUSING the pieces that
// already exist here — whisper, the overlay codegen (config.overlay.enabled), the deterministic
// renderer and concat — instead of growing a second pipeline:
//
//   probe + transcribe → segment into scenes → runVisuals(overlay) → render+composite → concat
//
// The one thing that differs from plain overlay mode is ownership of time and sound: these
// scenes were CUT FROM the footage, so each composites onto its exact source moment and keeps
// the original soundtrack (config.overlay.mode = 'edit' → compositeColorkey exact/audioFrom).
// No TTS is ever spent: the narration is already in the file.
import { existsSync } from 'node:fs';
import * as DB from '../db/index.js';
import { transcribeWords, whisperAvailable } from '../media/whisper.js';
import { chat, llmEnabled } from '../providers/llm.js';
import { probeDuration, probeImageSize } from '../media/ffmpeg.js';
import { safeJson } from '../util/util.js';
import { runVisuals } from './stages/visuals.js';
import { runRender } from './stages/render.js';
import { finalize } from './stages/finalize.js';
import { buildSrt } from './srt.js';
import { clearStop, isStopped } from './stop.js';
import { step, op } from './progress.js';
import { jlog } from './journal.js';

/** Aspect ratio label closest to the source's real pixels, so overlays are authored at its shape. */
export function ratioOf(w, h) {
  if (!w || !h) return '16:9';
  const r = w / h;
  const cands = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:5', 0.8]];
  return cands.reduce((best, c) => (Math.abs(r - c[1]) < Math.abs(r - best[1]) ? c : best))[0];
}

/**
 * Cut a transcript into scene-sized segments. Units are whisper phrases ({start,end,text}) or
 * single words ({start,end,word}) — both shapes work, so the same function serves the
 * segment-level pass used here and a word-level one.
 * Segments end on a sentence boundary when one falls in range, and a trailing scrap is merged
 * back — a 0.4s scene would render a graphic nobody can read.
 * @returns {{start,end,text,words}[]}
 */
export function segmentTranscript(units = [], { target = 7, min = 3, max = 12, total = 0 } = {}) {
  const list = (units || [])
    .map((u) => (u && Number.isFinite(u.start) ? { start: u.start, end: u.end, word: String(u.word ?? u.text ?? '').trim() } : null))
    .filter((u) => u && u.word);
  if (!list.length) {
    // No speech at all — still cut the footage into even chapters so the video gets graphics.
    const dur = Math.max(0, total);
    if (dur < min) return dur > 0 ? [{ start: 0, end: dur, text: '', words: [] }] : [];
    const n = Math.max(1, Math.round(dur / target));
    const step0 = dur / n;
    return Array.from({ length: n }, (_, i) => ({
      start: +(i * step0).toFixed(3), end: +Math.min(dur, (i + 1) * step0).toFixed(3), text: '', words: [],
    }));
  }
  const ENDS = /[.!?…]["'”’)\]]?$/;
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      start: +cur[0].start.toFixed(3),
      end: +cur[cur.length - 1].end.toFixed(3),
      text: cur.map((w) => w.word).join(' ').replace(/\s+([,.!?;:…])/g, '$1').trim(),
      words: cur.slice(),
    });
    cur = [];
  };
  // Cut on the sentence boundary NEAREST the target rather than the first one past it: with
  // ~5s sentences a "≥ target" rule would only break every other sentence and land 10s scenes.
  const softFloor = Math.max(min, target * 0.6);
  for (const w of list) {
    cur.push(w);
    const span = w.end - cur[0].start;
    if (span >= max || (ENDS.test(w.word) && span >= softFloor)) flush();
  }
  flush();
  // merge a too-short tail into its predecessor rather than shipping a flash of a scene
  if (out.length > 1 && out[out.length - 1].end - out[out.length - 1].start < min) {
    const tail = out.pop();
    const prev = out[out.length - 1];
    prev.end = tail.end;
    prev.text = `${prev.text} ${tail.text}`.trim();
    prev.words = prev.words.concat(tail.words);
  }
  // tile the whole file: stretch the first/last segment over any silent head and tail so the
  // composited scenes reconstruct the source exactly, with no dropped frames between them.
  if (out.length) {
    out[0].start = 0;
    for (let i = 1; i < out.length; i++) out[i].start = out[i - 1].end;
    if (total > out[out.length - 1].end) out[out.length - 1].end = +total.toFixed(3);
  }
  return out;
}

/** Scene rows for the DB: transcript text + word timings rebased to the scene's own zero. */
export function scenesFromSegments(segments = []) {
  return segments.map((seg, i) => {
    const dur = Math.max(0.8, +(seg.end - seg.start).toFixed(3));
    const cues = [];
    let bucket = [];
    const push = () => {
      if (!bucket.length) return;
      cues.push({
        start: +Math.max(0, bucket[0].start - seg.start).toFixed(3),
        end: +Math.max(0.1, bucket[bucket.length - 1].end - seg.start).toFixed(3),
        text: bucket.map((w) => w.word).join(' '),
        words: bucket.map((w) => ({ start: +Math.max(0, w.start - seg.start).toFixed(3), end: +Math.max(0, w.end - seg.start).toFixed(3), word: w.word })),
      });
      bucket = [];
    };
    for (const w of seg.words || []) {
      bucket.push(w);
      // A unit may be one word (word-level pass) or a whole phrase (segment-level pass) — a
      // phrase is already a caption line, so flush immediately when it carries spaces.
      if (bucket.length >= 7 || /\s/.test(w.word) || /[.!?…,;:]$/.test(w.word)) push();
    }
    push();
    return {
      voice: seg.text,
      visual: '',
      keywords: [],
      _duration: dur,
      _srt: cues,
      _sourceStart: +seg.start.toFixed(3),
    };
  });
}

/**
 * Repair an ASR transcript with the LLM (reference parity: its `ai-fix-srt`).
 * Speech recognition is the ceiling of this lane — with no script to align to, a small whisper
 * model mangles Vietnamese diacritics ("FAMO TANG NANG SUK" for "Ba mẹo tăng năng suất"). One
 * call fixes spelling/diacritics/spacing WITHOUT touching timings or the number of lines; a
 * reply that changes the line count is rejected wholesale, so a bad repair can never desync the
 * video. No LLM → the raw transcript is used unchanged.
 * @returns {Promise<{start,end,text}[]>}
 */
export async function repairTranscript(segments = [], { language = 'vi', llm = null, onLog = () => {} } = {}) {
  const list = (segments || []).filter((s) => s && s.text);
  if (list.length < 1 || !llmEnabled(llm)) return segments;
  const langName = language === 'en' ? 'English' : (language && language !== 'auto' ? language : 'Vietnamese');
  const numbered = list.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
  try {
    const reply = await chat([
      { role: 'system', content: `You repair ${langName} speech-to-text output. The recognizer mangles spelling, diacritics, word boundaries and proper nouns, but the SOUND is right — rewrite each line into what was actually said, in correct ${langName}. Keep the meaning and the length; never merge, split, reorder, drop or add lines; never translate; never add commentary.` },
      { role: 'user', content: `Return ONLY a JSON array of ${list.length} strings — the corrected text of each line, in order.\n\n${numbered}` },
    ], { json: true, temperature: 0.2, maxTokens: Math.min(8000, 400 + list.length * 80), llm });
    const fixed = safeJson(reply, null);
    const arr = Array.isArray(fixed) ? fixed : (Array.isArray(fixed?.lines) ? fixed.lines : null);
    if (!arr || arr.length !== list.length) {
      onLog(`sửa lời thoại: bỏ qua (model trả ${arr ? arr.length : 'không phải'} dòng, cần ${list.length})`);
      return segments;
    }
    onLog(`sửa lời thoại: đã hiệu đính ${list.length} dòng bằng AI`);
    return list.map((s, i) => ({ ...s, text: String(arr[i] || s.text).trim() || s.text }));
  } catch (e) {
    onLog(`sửa lời thoại: bỏ qua (${e.message.slice(0, 100)})`);
    return segments;
  }
}

/** True when this project is an edit-video job rather than a scripted one. */
export function isEditVideo(config) {
  return !!(config && config.editVideo && config.editVideo.source);
}

/**
 * Create (but do not run) an edit-video project from an existing file. The caller starts it
 * through the ordinary queue, so stop/resume/render-only/job-ledger all behave as usual.
 * @param {{source:string, title?:string, language?:string, config?:object, channelId?:string}} opts
 */
export async function createEditVideoProject({ source, title = '', language = 'auto', config = {}, channelId = null } = {}) {
  const src = String(source || '');
  if (!src || !existsSync(src)) throw new Error('không tìm thấy file video nguồn');
  if (!whisperAvailable()) throw new Error('cần whisper để bóc lời thoại từ video (kiểm tra Cài đặt → phụ đề)');

  const total = await probeDuration(src);
  if (!(total > 0.5)) throw new Error('video nguồn không đọc được thời lượng');
  const dims = await probeSize(src);
  const aspectRatio = config.aspectRatio || ratioOf(dims.w, dims.h);

  // Overlay mode carries the whole lane: the codegen designs transparent graphics and the
  // renderer composites them. 'edit' additionally pins each scene to its own source moment.
  const cfg = {
    ...config,
    aspectRatio,
    editVideo: { source: src, sourceDuration: +total.toFixed(3) },
    overlay: { enabled: true, source: src, key: config.overlay?.key || '#050510', mode: 'edit' },
    // The footage already carries its own voice and music — never mix ours over it, and never
    // spend TTS credit: the narration is already in the file.
    autoBgm: false, soundDesign: false, enableSubtitles: config.enableSubtitles === true,
    transitions: false, // cuts belong to the owner's edit, not to us
    language,
  };
  return DB.createProject({
    title: title || `Sửa video · ${src.split('/').pop()}`.slice(0, 120),
    topic: title || 'edit-video', inputType: 'video', aspectRatio, config: cfg, channelId,
  });
}

/**
 * Run an edit-video project: transcribe → segment → the ORDINARY visuals/render/finalize stages.
 * Called by the pipeline orchestrator when config.editVideo is present, so a resumed run picks
 * up right where it stopped (scenes already cut → straight back to codegen).
 * @param {import('./context.js').PipelineContext} ctx
 */
export async function runEditVideo(ctx) {
  const { projectId, config } = ctx;
  const src = config.editVideo.source;
  if (!existsSync(src)) throw new Error(`video nguồn không còn ở ${src}`);
  clearStop(projectId);

  const existing = DB.getScenes(projectId);
  if (!existing.length) {
    step(projectId, 'b2', 'running', 'Bóc lời thoại từ video');
    op(projectId, '🎧 Đang bóc lời thoại (whisper)…');
    jlog(projectId, { kind: 'status', msg: `🎬 Sửa video: ${src.split('/').pop()}` });
    const total = config.editVideo.sourceDuration || await probeDuration(src);
    // Segment granularity: the transcript is CONTENT here (it becomes the scene's narration and
    // drives the design), so decoding accuracy beats per-word karaoke timing.
    const { segments: raw } = await transcribeWords(src, { language: config.language || 'auto', granularity: 'segment' });
    if (isStopped(projectId)) throw Object.assign(new Error('stopped'), { stopped: true });
    op(projectId, `📝 Bóc được ${raw.length} câu — đang hiệu đính…`);
    const fixed = await repairTranscript(raw, {
      language: config.language || 'vi', llm: ctx.ai?.llm,
      onLog: (m) => op(projectId, `📝 ${m}`),
    });

    const segments = segmentTranscript(fixed, { target: Math.max(3, +config.sceneDuration || 7), total });
    if (!segments.length) throw new Error('không cắt được cảnh nào từ video nguồn');
    const rows = scenesFromSegments(segments);
    DB.replaceScenes(projectId, rows);
    // Duration + word timings are per-scene state, not script content, so they are written after.
    DB.getScenes(projectId).forEach((sc, i) => {
      DB.updateScene(sc.id, { duration: rows[i]._duration, srt_json: rows[i]._srt, status: 'script' });
    });
    step(projectId, 'b2', 'done', `${segments.length} cảnh · ${Math.round(total)}s`);
    op(projectId, `✂️ Đã cắt ${segments.length} cảnh từ ${Math.round(total)}s video`);
  } else {
    op(projectId, `▶ Tiếp tục: ${existing.length} cảnh đã bóc sẵn`);
  }

  // From here the ordinary stages do the work — same codegen, same renderer, same concat.
  // No TTS stage: every scene's audio comes from the footage at composite time.
  await runVisuals(ctx);
  await runRender(ctx);
  return finalize(projectId, { dir: ctx.dir, size: ctx.size, config: ctx.config });
}

/** Source pixel dimensions (falls back to 16:9 defaults when the probe says nothing). */
async function probeSize(path) {
  try {
    const size = await probeImageSize(path); // first video stream — works for video too
    if (size?.w && size?.h) return size;
  } catch { /* fall through */ }
  return { w: 1920, h: 1080 };
}

/** SRT of the whole transcribed source — handy for review/export in the UI. */
export function editVideoSrt(projectId) {
  const scenes = DB.getScenes(projectId).sort((a, b) => a.idx - b.idx);
  const cues = [];
  let t = 0;
  for (const sc of scenes) {
    for (const c of sc.srt_json || []) cues.push({ start: t + c.start, end: t + c.end, text: c.text });
    t += sc.duration || 0;
  }
  return buildSrt(cues);
}

