// The spawn wrapper every other module goes through: stoppable, filtergraph kept off argv, the two binaries.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS, PATHS } from '../../config/paths.js';
import { stopError } from '../../pipeline/stop.js';

// internal spawn wrapper — callers use ffmpeg()/ffmpegAss() below.
//
// `signal` is how "Dừng" reaches a running encode. A concat can occupy one ffmpeg process for a
// quarter of an hour, and the pipeline's checkpoints only fire BETWEEN steps — so without this
// the stop was honoured only once the encode had finished doing the work being cancelled.
//
// An abort is reported as a stop, not as a failure: the error carries `.stopped`, which is the
// tag the orchestrator reads to settle the run as paused. Left as a plain AbortError it would be
// classified as a crash, shown as "⛔ Pipeline lỗi", and — because it looks retryable — trigger
// the automatic resume, restarting the very render the owner just stopped.
//
// The filtergraph never travels as an argument. `ps -ax -o command` shows every argv of a running
// process to any account on the machine, and our graph IS the transition doctrine — dip lengths,
// xfade offsets, the audio seam. `-filter_complex_script` takes the same string from a file that
// lives only as long as the encode.
export function detachFilterGraph(args) {
  const i = args.indexOf('-filter_complex');
  if (i < 0 || typeof args[i + 1] !== 'string') return { args, cleanup: () => {} };
  mkdirSync(DIRS.tmp, { recursive: true });
  const file = join(DIRS.tmp, `fg-${randomBytes(8).toString('hex')}.txt`);
  writeFileSync(file, args[i + 1], 'utf8');
  const next = args.slice();
  next.splice(i, 2, '-filter_complex_script', file);
  return { args: next, cleanup: () => rmSync(file, { force: true }) };
}

function run(bin, args, { onLog, signal } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(stopError());
    const graph = detachFilterGraph(args);
    const done = (fn) => (v) => { graph.cleanup(); fn(v); };
    const resolveOnce = done(resolvePromise);
    const rejectOnce = done(reject);
    const ps = spawn(bin, graph.args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let err = '';
    ps.stdout.on('data', (d) => onLog && onLog(d.toString()));
    ps.stderr.on('data', (d) => { const s = d.toString(); err += s; onLog && onLog(s); });
    ps.on('error', (e) => rejectOnce(signal?.aborted ? stopError() : e));
    ps.on('close', (code) => {
      if (signal?.aborted) return rejectOnce(stopError());
      return code === 0 ? resolveOnce({ code, err }) : rejectOnce(new Error(`${bin} exit ${code}: ${err.slice(-600)}`));
    });
  });
}

export function ffmpeg(args, opts) { return run(PATHS.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], opts); }

// libass-capable build — required only for filters like subtitles=/ass= (image-mode burn).
export function ffmpegAss(args, opts) {
  return run(PATHS.ffmpegAss || PATHS.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], opts);
}

// Does the libass-capable binary carry drawtext (freetype)? Homebrew's ffmpeg often does
// NOT, so the text-watermark lane must both (a) check this and (b) run via ffmpegAss.
let _hasDrawtext = null;
export function hasDrawtext() {
  if (_hasDrawtext !== null) return _hasDrawtext;
  return (_hasDrawtext = new Promise((resolvePromise) => {
    const ps = spawn(PATHS.ffmpegAss || PATHS.ffmpeg, ['-hide_banner', '-filters']);
    let out = '';
    ps.stdout.on('data', (d) => out += d.toString());
    ps.on('close', () => resolvePromise(/\bdrawtext\b/.test(out)));
    ps.on('error', () => resolvePromise(false));
  }));
}
