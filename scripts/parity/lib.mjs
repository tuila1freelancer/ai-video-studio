// Shared helpers for the visual-parity harness (scripts/parity/*): reference-session
// access (READ-ONLY), SRT parsing, word-timing synthesis, ffmpeg frame extraction.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const REF_SESSIONS = process.env.AVS_REF_SESSIONS
  || join(homedir(), 'Library/Application Support/VideoPipeline/sessions');

export function refPaths(sid, n) {
  const base = join(REF_SESSIONS, sid);
  return {
    html: join(base, 'compositions', `scene-${n}.html`),
    htmlAlt: join(base, 'html', `${n}.html`),
    video: join(base, 'video', `${n}.mp4`),
    audio: join(base, 'audio', `${n}.mp3`),
    srt: join(base, 'srt', `${n}.srt`),
    script: join(base, 'script.json'),
    state: join(base, 'state.json'),
  };
}

export function readScript(sid) {
  return JSON.parse(readFileSync(refPaths(sid, 1).script, 'utf8'));
}

// "00:01:02,340" → seconds
function ts(s) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}

export function parseSrt(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const txt = lines.slice(ti + 1).join(' ').trim();
    if (!txt) continue;
    cues.push({ start: ts(a), end: ts(b), text: txt });
  }
  return cues;
}

// Cue-level SRT → the srt_json shape the pipeline stores (words spread linearly inside
// each cue span) so extractBeats/timewarp see real per-word timing.
export function cuesToSrtJson(cues) {
  return cues.map((c) => {
    const words = c.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0.05, c.end - c.start);
    const per = span / Math.max(1, words.length);
    return {
      start: c.start, end: c.end, text: c.text,
      words: words.map((w, i) => ({ word: w, start: +(c.start + i * per).toFixed(3), end: +(c.start + (i + 1) * per).toFixed(3) })),
    };
  });
}

export function ffprobeDur(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat(out.trim());
}

// Extract single frames at absolute times (seconds) → jpg paths.
export function extractFrames(video, times, outDir, prefix) {
  mkdirSync(outDir, { recursive: true });
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const p = join(outDir, `${prefix}_${i}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(times[i]), '-i', video, '-frames:v', '1', '-q:v', '3', p, '-y']);
    out.push(p);
  }
  return out;
}

// Tile a list of image files into one sheet: rows of `cols` images, each scaled to `cellW`.
export function tileImages(files, cols, cellW, outPath) {
  const rows = [];
  for (let i = 0; i < files.length; i += cols) rows.push(files.slice(i, i + cols));
  const inputs = files.flatMap((f) => ['-i', f]);
  const scaled = files.map((_, i) => `[${i}:v]scale=${cellW}:-1[s${i}]`).join(';');
  const rowExpr = rows.map((row, r) => {
    const tags = row.map((f) => `[s${files.indexOf(f)}]`).join('');
    return row.length > 1 ? `${tags}hstack=inputs=${row.length}[r${r}]` : `${tags}null[r${r}]`;
  }).join(';');
  const stackExpr = rows.length > 1 ? `${rows.map((_, r) => `[r${r}]`).join('')}vstack=inputs=${rows.length}[out]` : '[r0]null[out]';
  execFileSync('ffmpeg', ['-v', 'error', ...inputs, '-filter_complex', `${scaled};${rowExpr};${stackExpr}`, '-map', '[out]', '-q:v', '3', outPath, '-y']);
  return outPath;
}

export const SAMPLE_FRACS = [0.25, 0.5, 0.75, 0.95];

export function sampleTimes(duration) {
  return SAMPLE_FRACS.map((f) => +(Math.min(duration - 0.08, duration * f)).toFixed(2));
}

export function loadManifest(path) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  for (const e of m.samples) {
    const p = refPaths(e.sid, e.n);
    if (!existsSync(p.video)) throw new Error(`manifest sample missing on disk: ${e.sid}/${e.n}`);
  }
  return m;
}
