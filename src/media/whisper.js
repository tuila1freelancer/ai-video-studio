// whisper.cpp (whisper-cli) → word-level timestamps for karaoke subtitles.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, DIRS } from '../config/paths.js';
import { ffmpeg } from './ffmpeg.js';
import { newId, safeJson } from '../util/util.js';

export function whisperAvailable() { return !!(PATHS.whisperCli && PATHS.whisperModel); }

// Returns { words:[{start,end,word}], cues:[{start,end,text}] } with times in seconds.
// opts.prompt: bias decoding toward the known script (forced-alignment feeds the narration
// here so names/numbers transcribe the way they were written).
export async function transcribeWords(audioPath, { language = 'auto', onLog, prompt = '' } = {}) {
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
  if (prompt) args.push('--prompt', String(prompt).slice(0, 400));
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
// Layout rules: a strong punctuation mark ends the cue early (phrase-shaped lines read
// better than fixed-length chops), and a trailing one-word orphan merges back into the
// previous cue. Cue schema {start,end,text,words[]} is unchanged (P11: beats + karaoke).
const STRONG_PUNCT = /[.!?…;:]["'”’)\]]?$/;
export function groupWordsIntoCues(words, { maxWords = 7, maxDur = 3.2 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    if (!cur) { cur = { start: w.start, end: w.end, words: [w] }; continue; }
    const tooLong = cur.words.length >= maxWords || (w.end - cur.start) > maxDur;
    if (tooLong) { cues.push(finishCue(cur)); cur = { start: w.start, end: w.end, words: [w] }; continue; }
    cur.end = w.end; cur.words.push(w);
    // phrase boundary: break after strong punctuation once the line has some body
    if (cur.words.length >= 3 && STRONG_PUNCT.test(w.word)) { cues.push(finishCue(cur)); cur = null; }
  }
  if (cur) cues.push(finishCue(cur));
  // orphan merge: a lone trailing word joins the previous cue instead of flashing alone
  if (cues.length >= 2) {
    const last = cues[cues.length - 1], prev = cues[cues.length - 2];
    if (last.words.length === 1 && prev.words.length < maxWords + 2 && (last.end - prev.start) <= maxDur + 1.2) {
      prev.words.push(...last.words);
      prev.end = last.end;
      prev.text = prev.words.map((w) => w.word).join(' ');
      cues.pop();
    }
  }
  return cues;
}
function finishCue(c) { return { start: c.start, end: c.end, text: c.words.map((w) => w.word).join(' '), words: c.words }; }
