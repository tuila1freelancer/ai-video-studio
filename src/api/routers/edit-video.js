// Edit-video lane: quick cut, standalone transcription, motion graphics onto the owner's own footage (P40).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as DB from '../../db/index.js';
import { DIRS } from '../../config/paths.js';
import { logger } from '../../util/log.js';
import { newId } from '../../util/util.js';
import * as Pipeline from '../../pipeline/queue.js';
import { inAllowedRoots } from '../services/file-access.js';
import { majorityLang, DEFAULT_LANG } from '../../util/lang.js';
import { ffmpeg } from '../../media/ffmpeg.js';
import { transcribeWords, whisperAvailable } from '../../media/whisper.js';
import { repairTranscript, createEditVideoProject, editVideoSrt } from '../../pipeline/edit-video.js';
import { buildSrt } from '../../pipeline/srt.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- edit video: quick cut ----
  r.post('/edit-cut', async (req, res) => {
    try {
      const { path: inPath, start = 0, end = 10 } = req.body || {};
      const src = resolve(inPath || '');
      if (!inAllowedRoots(src) || !existsSync(src)) return res.status(400).json({ error: 'file không hợp lệ' });
      const dur = Math.max(0.5, (+end) - (+start));
      const out = join(DIRS.uploads, `${newId('cut')}.mp4`);
      await ffmpeg(['-ss', String(start), '-i', src, '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', out]);
      res.json({ path: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Standalone transcription (P42 — reference `/edit-video/transcribe`): read the words out of a
  // video or audio file WITHOUT starting a project or spending anything but CPU. Same segment
  // granularity and the same optional AI spelling repair the edit-video lane uses.
  r.post('/edit-video/transcribe', async (req, res) => {
    try {
      const src = resolve(String(req.body?.path || ''));
      if (!inAllowedRoots(src) || !existsSync(src)) return res.status(400).json({ error: 'file không hợp lệ' });
      if (!whisperAvailable()) return res.status(400).json({ error: 'chưa có whisper (kiểm tra Cài đặt → phụ đề)' });
      const language = String(req.body?.language || 'auto');
      const { segments } = await transcribeWords(src, { language, granularity: 'segment' });
      let cues = segments;
      if (req.body?.repair !== false) {
        // 'auto' means the owner did not say; read it off the transcript rather than assuming
        // Vietnamese, which is what silently mangled every non-Vietnamese import.
        const repairLang = language === 'auto' ? majorityLang(segments.map((c) => c.text)) || DEFAULT_LANG : language;
        cues = await repairTranscript(segments, { language: repairLang, llm: DB.aiSettings().llm });
      }
      res.json({ cues, srt: buildSrt(cues.map((c) => ({ start: c.start, end: c.end, text: c.text }))) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- edit video (P40): motion graphics onto footage the owner already has ----
  // Creates a normal project carrying config.editVideo, then starts it through the ordinary
  // queue — so stop/resume/re-render/the job ledger all work exactly as for a scripted video.
  r.post('/edit-video/start', async (req, res) => {
    try {
      const { path: inPath, title, language, config } = req.body || {};
      const src = resolve(inPath || '');
      if (!inAllowedRoots(src) || !existsSync(src)) return res.status(400).json({ error: 'file không hợp lệ' });
      const project = await createEditVideoProject({
        source: src, title, language: language || 'auto', config: config || {},
      });
      Pipeline.startProject(project.id).catch((e) => logger.error(`edit-video failed: ${e.message}`, { projectId: project.id }));
      res.json({ projectId: project.id, aspectRatio: project.aspect_ratio, status: 'running' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Full transcript of an edit-video project, as SRT on the finished timeline.
  r.get('/edit-video/:id/srt', async (req, res) => {
    try {
      res.type('text/plain').send(editVideoSrt(req.params.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
