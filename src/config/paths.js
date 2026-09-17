// Resolve external binaries + runtime directories.
// Strategy: ENV override → vendor/ → original app bundle → system PATH → null (graceful fallback).
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// One climb, two layouts. Running from the repo this file sits at src/config/paths.js; in a release
// the whole server is a single file at the payload root. Anchoring on the directory that actually
// holds package.json AND public/ lands on the right root in both, with nothing to configure — and
// ROOT is what finds vendor/ffmpeg, so getting it wrong silently downgrades a customer to whatever
// ffmpeg their machine happens to have.
function findAppRoot(from) {
  let dir = from;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'public'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return resolve(from, '..', '..');
}

export const ROOT = findAppRoot(__dirname);
export const DATA_DIR = process.env.AVS_DATA_DIR || join(ROOT, 'data');
export const VENDOR_DIR = join(ROOT, 'vendor');

// The original app we are replacing — reuse its heavy binaries (whisper model, Chrome) if present.
// macOS-only by construction: it is an .app bundle path.
const ORIG_APP = '/Applications/AI VIDEO Tool.app/Contents/Resources/_up_/binaries';

// Everything below resolves against a PLATFORM rather than assuming macOS. The pipeline itself is
// portable Node — it was only ever these few lookups that pinned the app to one operating system.
// Passing the platform in (instead of reading process.platform inline) is what makes the Windows
// branch testable from a Mac: the resolver is a pure function of (platform, env, what exists).
function whichOn(platform, cmd) {
  try {
    const out = platform === 'win32'
      ? execSync(`where ${cmd}`, { encoding: 'utf8' })
      : execSync(`/usr/bin/which ${cmd}`, { encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || null;
  } catch { return null; }
}
function firstExisting(...candidates) {
  for (const c of candidates) { if (c && existsSync(c)) return c; }
  return null;
}

/** @param {string} platform @param {Record<string,string|undefined>} env */
export function resolvePaths(platform = process.platform, env = process.env) {
  const win = platform === 'win32';
  const exe = (n) => (win ? `${n}.exe` : n);
  const which = (cmd) => whichOn(platform, cmd);
  // A path from the macOS-only reference bundle is worse than nothing off macOS: it can never
  // exist, and listing it just makes the candidate chain lie about where things come from.
  const orig = (...parts) => (platform === 'darwin' ? join(ORIG_APP, ...parts) : null);

  // Main ffmpeg = FASTEST available (native-arch Homebrew first — the vendored static build is
  // x86_64-only and runs under Rosetta on Apple Silicon, ~4-7× slower for encodes).
  const systemFfmpeg = win
    ? ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']
    : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  const systemFfprobe = win
    ? ['C:\\ffmpeg\\bin\\ffprobe.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe']
    : ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];

  // Chrome ships in a different place on every OS; the vendored Chrome-for-Testing layout also
  // differs (an .app on macOS, a plain folder elsewhere).
  const chromeCandidates = win ? [
    join(VENDOR_DIR, 'chrome', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ] : platform === 'darwin' ? [
    join(VENDOR_DIR, 'chrome', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    orig('chrome', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : [
    join(VENDOR_DIR, 'chrome', 'chrome'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];

  return {
    // The app's own web assets, including the interface translation catalogues that the
    // server and the browser both read.
    publicDir: join(ROOT, 'public'),
    ffmpeg: env.AVS_FFMPEG || firstExisting(
      ...systemFfmpeg,
      join(VENDOR_DIR, 'ffmpeg', exe('ffmpeg')),
      orig('ffmpeg', 'ffmpeg')
    ) || which('ffmpeg'),
    ffprobe: env.AVS_FFPROBE || firstExisting(
      ...systemFfprobe,
      join(VENDOR_DIR, 'ffmpeg', exe('ffprobe')),
      orig('ffmpeg', 'ffprobe')
    ) || which('ffprobe'),
    // libass-capable build (subtitles/ass filters) — only needed by image-mode subtitle burn.
    ffmpegAss: env.AVS_FFMPEG_ASS || firstExisting(
      join(VENDOR_DIR, 'ffmpeg', exe('ffmpeg')),
      orig('ffmpeg', 'ffmpeg')
    ),
    // /usr/bin/say is macOS text-to-speech. There is no equivalent to point at elsewhere, so the
    // provider simply reports itself unavailable — the channel's real voice comes from LarVoice.
    say: env.AVS_SAY || (platform === 'darwin' ? firstExisting('/usr/bin/say') : null),
    whisperCli: env.AVS_WHISPER || firstExisting(
      join(VENDOR_DIR, 'whisper', exe('whisper-cli')),
      orig('whisper', 'whisper-cli')
    ) || which('whisper-cli'),
    // Biggest model wins. Transcript quality is the ceiling for the edit-video lane (P40), where
    // there is no script to align against — ggml-small mangles Vietnamese diacritics badly. Drop a
    // larger ggml file into vendor/whisper/models/ and it is picked up with no config change.
    whisperModel: env.AVS_WHISPER_MODEL || firstExisting(
      ...['large-v3-turbo', 'large-v3', 'large-v2', 'large', 'medium', 'small', 'base']
        .flatMap((m) => [join(VENDOR_DIR, 'whisper', 'models', `ggml-${m}.bin`), orig('whisper', 'models', `ggml-${m}.bin`)])
    ),
    chrome: env.AVS_CHROME || firstExisting(...chromeCandidates),
  };
}

export const PATHS = resolvePaths();

// Runtime directory layout
export const DIRS = {
  data: DATA_DIR,
  projects: join(DATA_DIR, 'projects'),
  library: join(DATA_DIR, 'library'),
  brand: join(DATA_DIR, 'library', 'brand'),
  bgm: join(DATA_DIR, 'library', 'bgm'),
  sfx: join(DATA_DIR, 'library', 'sfx'),
  font: join(DATA_DIR, 'library', 'fonts'),
  // Families fetched from Google Fonts on request. Separate from `font` (the owner's own
  // uploads) so a cache purge never touches a brand asset somebody had to go and find.
  fontWeb: join(DATA_DIR, 'library', 'fonts-web'),
  uploads: join(DATA_DIR, 'uploads'),
  tmp: join(DATA_DIR, 'tmp'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
}

// Project working dir inside an arbitrary channel root (Default channel root = DATA_DIR,
// which yields the original data/projects/<id> layout — full backward compatibility).
// The skeleton is created once per process; a project deleted from disk gets it back (one stat).
const projectDirsEnsured = new Set();
export function projectDirIn(rootDir, id) {
  const p = join(rootDir || DATA_DIR, 'projects', String(id));
  if (!projectDirsEnsured.has(p) || !existsSync(p)) {
    for (const sub of ['', 'audio', 'srt', 'html', 'render', 'assets', 'output']) {
      mkdirSync(join(p, sub), { recursive: true });
    }
    projectDirsEnsured.add(p);
  }
  return p;
}

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
