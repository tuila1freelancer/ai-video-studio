// whisper.cpp (whisper-cli) → word-level timestamps for karaoke subtitles.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, DIRS } from '../config/paths.js';
import { ffmpeg } from './ffmpeg.js';
import { newId, safeJson } from '../util/util.js';

export function whisperAvailable() { return !!(PATHS.whisperCli && PATHS.whisperModel); }

// Returns { words:[{start,end,word}], cues:[{start,end,text}] } with times in seconds.
export async function transcribeWords(audioPath, { language = 'auto', onLog } = {}) {
  if (!whisperAvailable()) throw new Error('whisper not available');
  const wav = join(DIRS.tmp, `${newId('w')}.wav`);
  await ffmpeg(['-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  const base = join(DIRS.tmp, newId('wj'));
  const args = [
    '-m', PATHS.whisperModel, '-f', wav,
    '-oj', '-of', base,
    '-ml', '1', '-sow',            // one word per segment (karaoke granularity)
    '-t', String(Math.max(2, Math.min(8, (await import('node:os')).cpus?.().length || 4))),
  ];
  if (language && language !== 'auto') args.push('-l', language);
  await new Promise((resolvePromise, reject) => {
    const ps = spawn(PATHS.whisperCli, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ps.stdout.on('data', (d) => onLog && onLog(d.toString()));
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`whisper exit ${code}: ${err.slice(-400)}`)));
  });
  const jsonPath = `${base}.json`;
  let words = [];
  if (existsSync(jsonPath)) {
    const data = safeJson(readFileSync(jsonPath, 'utf8'), null);
    const segs = (data && data.transcription) || [];
    words = segs.map((s) => ({
      start: (s.offsets ? s.offsets.from : 0) / 1000,
      end: (s.offsets ? s.offsets.to : 0) / 1000,
      word: (s.text || '').trim(),
    })).filter((w) => w.word);
  }
  for (const f of [wav, jsonPath]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ } }
  return { words, cues: groupWordsIntoCues(words) };
}

// Group words into subtitle cues (lines) of up to N words / max duration.
export function groupWordsIntoCues(words, { maxWords = 7, maxDur = 3.2 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    if (!cur) { cur = { start: w.start, end: w.end, words: [w] }; continue; }
    const tooLong = cur.words.length >= maxWords || (w.end - cur.start) > maxDur;
    if (tooLong) { cues.push(finishCue(cur)); cur = { start: w.start, end: w.end, words: [w] }; }
    else { cur.end = w.end; cur.words.push(w); }
  }
  if (cur) cues.push(finishCue(cur));
  return cues;
}
function finishCue(c) { return { start: c.start, end: c.end, text: c.words.map((w) => w.word).join(' '), words: c.words }; }
