// Resolve external binaries + runtime directories.
// Strategy: ENV override → vendor/ → original app bundle → system PATH → null (graceful fallback).
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.AVS_DATA_DIR || join(ROOT, 'data');
export const VENDOR_DIR = join(ROOT, 'vendor');

// The original app we are replacing — reuse its heavy binaries (whisper model, Chrome) if present.
const ORIG_APP = '/Applications/AI VIDEO Tool.app/Contents/Resources/_up_/binaries';

function which(cmd) {
  try { return execSync(`/usr/bin/which ${cmd}`, { encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}
function firstExisting(...candidates) {
  for (const c of candidates) { if (c && existsSync(c)) return c; }
  return null;
}

export const PATHS = {
  // Main ffmpeg = FASTEST available (native-arch Homebrew first — the vendored static build is
  // x86_64-only and runs under Rosetta on Apple Silicon, ~4-7× slower for encodes).
  ffmpeg: process.env.AVS_FFMPEG || firstExisting(
    '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg',
    join(VENDOR_DIR, 'ffmpeg', 'ffmpeg'),
    join(ORIG_APP, 'ffmpeg', 'ffmpeg')
  ) || which('ffmpeg'),
  ffprobe: process.env.AVS_FFPROBE || firstExisting(
    '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe',
    join(VENDOR_DIR, 'ffmpeg', 'ffprobe'),
    join(ORIG_APP, 'ffmpeg', 'ffprobe')
  ) || which('ffprobe'),
  // libass-capable build (subtitles/ass filters) — only needed by image-mode subtitle burn.
  ffmpegAss: process.env.AVS_FFMPEG_ASS || firstExisting(
    join(VENDOR_DIR, 'ffmpeg', 'ffmpeg'),
    join(ORIG_APP, 'ffmpeg', 'ffmpeg')
  ),
  say: process.env.AVS_SAY || firstExisting('/usr/bin/say'),
  whisperCli: process.env.AVS_WHISPER || firstExisting(
    join(VENDOR_DIR, 'whisper', 'whisper-cli'),
    join(ORIG_APP, 'whisper', 'whisper-cli')
  ) || which('whisper-cli'),
  // Biggest model wins. Transcript quality is the ceiling for the edit-video lane (P40), where
  // there is no script to align against — ggml-small mangles Vietnamese diacritics badly. Drop a
  // larger ggml file into vendor/whisper/models/ and it is picked up with no config change.
  whisperModel: process.env.AVS_WHISPER_MODEL || firstExisting(
    ...['large-v3-turbo', 'large-v3', 'large-v2', 'large', 'medium', 'small', 'base']
      .flatMap((m) => [join(VENDOR_DIR, 'whisper', 'models', `ggml-${m}.bin`), join(ORIG_APP, 'whisper', 'models', `ggml-${m}.bin`)])
  ),
  chrome: process.env.AVS_CHROME || firstExisting(
    join(VENDOR_DIR, 'chrome', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(ORIG_APP, 'chrome', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ),
};

// Runtime directory layout
export const DIRS = {
  data: DATA_DIR,
  projects: join(DATA_DIR, 'projects'),
  library: join(DATA_DIR, 'library'),
  brand: join(DATA_DIR, 'library', 'brand'),
  bgm: join(DATA_DIR, 'library', 'bgm'),
  sfx: join(DATA_DIR, 'library', 'sfx'),
  font: join(DATA_DIR, 'library', 'fonts'),
  uploads: join(DATA_DIR, 'uploads'),
  tmp: join(DATA_DIR, 'tmp'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
}

// Project working dir inside an arbitrary channel root (Default channel root = DATA_DIR,
// which yields the original data/projects/<id> layout — full backward compatibility).
export function projectDirIn(rootDir, id) {
  const p = join(rootDir || DATA_DIR, 'projects', String(id));
  for (const sub of ['', 'audio', 'srt', 'html', 'render', 'assets', 'output']) {
    mkdirSync(join(p, sub), { recursive: true });
  }
  return p;
}

// Legacy signature — Default-channel layout.
export function projectDir(id) { return projectDirIn(DATA_DIR, id); }

// Create the on-disk skeleton for a channel root.
export function ensureChannelDirs(rootDir) {
  for (const sub of ['projects', 'library/bgm', 'library/logo', 'output']) {
    mkdirSync(join(rootDir, sub), { recursive: true });
  }
  return rootDir;
}

export function depStatus() {
  return {
    ffmpeg: !!PATHS.ffmpeg,
    ffprobe: !!PATHS.ffprobe,
    say: !!PATHS.say,
    whisper: !!(PATHS.whisperCli && PATHS.whisperModel),
    chrome: !!PATHS.chrome,
  };
}
