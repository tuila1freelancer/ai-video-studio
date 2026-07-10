// macOS `say` TTS → AIFF, then ffmpeg → wav/m4a. Offline, free, ships with macOS.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { PATHS, DIRS } from '../config/paths.js';
import { ffmpeg, probeDuration } from './ffmpeg.js';
import { newId } from '../util/util.js';

const pExecFile = promisify(execFile);

export async function listVoices() {
  if (!PATHS.say) return [];
  try {
    const { stdout } = await pExecFile(PATHS.say, ['-v', '?']);
    return stdout.trim().split('\n').map((line) => {
      const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#\s*(.*)$/);
      if (!m) return null;
      return { name: m[1].trim(), locale: m[2], sample: m[3] };
    }).filter(Boolean);
  } catch { return []; }
}

// Synthesize text → audio file (m4a/aac). Returns { path, duration }.
export async function synthesize(text, { voice = 'Samantha', rate = 175, outPath } = {}) {
  if (!PATHS.say) throw new Error('macOS `say` not available');
  const aiff = join(DIRS.tmp, `${newId('say')}.aiff`);
  const out = outPath || join(DIRS.tmp, `${newId('tts')}.m4a`);
  await new Promise((resolvePromise, reject) => {
    const args = ['-v', voice, '-r', String(rate), '-o', aiff, text];
    const ps = spawn(PATHS.say, args);
    let err = '';
    ps.stderr.on('data', (d) => err += d.toString());
    ps.on('error', reject);
    ps.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`say exit ${code}: ${err}`)));
  });
  await ffmpeg(['-i', aiff, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', out]);
  try { if (existsSync(aiff)) (await import('node:fs')).unlinkSync(aiff); } catch { /* ignore */ }
  const duration = await probeDuration(out);
  return { path: out, duration };
}

// Pick a reasonable default voice for a locale (prefers Vietnamese if available).
export async function pickVoice(preferLocale = 'vi_VN') {
  const voices = await listVoices();
  const vi = voices.find((v) => v.locale === preferLocale);
  if (vi) return vi.name;
  const en = voices.find((v) => v.locale === 'en_US' && /Samantha|Alex|Ava|Tom|Daniel/.test(v.name));
  return en ? en.name : (voices[0] && voices[0].name) || 'Samantha';
}
