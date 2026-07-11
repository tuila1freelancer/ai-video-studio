// GĐ5 test driver — boot server, run a fully-configured HyperFrame project, report timings.
// Usage: node test-drive.mjs '<topic>' <videoDuration> <aspectRatio> <timeoutMs> [ttsProvider]
// ttsProvider defaults to 'app': the project carries NO tts override, so the run uses the
// owner's in-app AI settings exactly (preferred provider, per-language voices, lexicon…).
// Pass an explicit provider id (e.g. 'edge') only when a test must avoid paid credits.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import WebSocket from 'ws';

const TOPIC = process.argv[2];
const VIDEO_DURATION = parseInt(process.argv[3] || '60', 10);
const AR = process.argv[4] || '9:16';
const TIMEOUT_MS = parseInt(process.argv[5] || '1800000', 10);
const TTS = process.argv[6] || 'app'; // 'app' = the in-app AI settings, untouched
const HF_MODEL = process.argv[7] || ''; // optional stronger model for the codegen/direction pass

function log(...a) { console.log('[drive]', ...a); }

const srv = spawn('node', ['src/server.js'], { env: { ...process.env, AVS_PORT: '0', AVS_DEBUG: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let base = null;
const ready = new Promise((res) => {
  srv.stdout.on('data', (d) => {
    const s = d.toString();
    const m = s.match(/AVS_READY (http:\/\/\S+)/);
    if (m) { base = m[1]; res(); }
  });
  srv.stderr.on('data', (d) => process.stderr.write('  ! ' + d.toString()));
});
const api = (path, opts) => fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then((r) => r.json());
const fail = (msg) => { console.error('[drive] FAIL:', msg); srv.kill(); process.exit(1); };
const timer = setTimeout(() => fail('timeout'), TIMEOUT_MS);

await ready;
log('server at', base);

const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({
  topic: TOPIC,
  config: {
    aspectRatio: AR, videoDuration: VIDEO_DURATION, sceneDuration: 7, enableSubtitles: true,
    visualMode: 'hyperframe', hyperframe: { styleId: 'tuila1-hud-cyber', density: 'balanced', ...(HF_MODEL ? { model: HF_MODEL, modelFallback: 'ag/gemini-3.1-pro-low' } : {}) },
    language: 'vi', ...(TTS !== 'app' ? { tts: { provider: TTS, voice: 'auto' } } : {}),
    autoConcat: true, parallelTTS: true, ttsConcurrency: 4, renderConcurrency: 3, fps: 30,
    watermarkText: 'tuila1 freelancer',
  },
}) });
log('project', project.id);

const t0 = Date.now();
const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
const done = new Promise((res, rej) => {
  ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', projectId: project.id })));
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.type === 'step') log(`+${((Date.now() - t0) / 1000).toFixed(0)}s STEP`, m.step, m.state, m.detail || '');
    else if (m.type === 'op') log('  op:', m.text);
    else if (m.type === 'retry') log('  🩹 RETRY', m.scope, m.step || '', m.idx ?? '', m.msg?.slice(0, 90) || '');
    else if (m.type === 'done') res(m);
    else if (m.type === 'error') rej(new Error(m.msg));
  });
});

await api(`/api/projects/${project.id}/start`, { method: 'POST', body: JSON.stringify({}) });
log('pipeline started…');
try { await done; } catch (e) { fail('pipeline error: ' + e.message); }

const { project: fin, scenes } = await api(`/api/projects/${project.id}`);
const hf = scenes.filter((s) => s.template === 'hyperframe').length;
const directed = scenes.filter((s) => /\[MAIN FOCUS\]/i.test(s.visual_prompt || '')).length;
log('scenes:', scenes.length, '| hyperframe:', hf, '| directed:', directed, '| fallback-template:', scenes.length - hf);
if (!fin.video_path || !existsSync(fin.video_path)) fail('video missing');
const sz = statSync(fin.video_path).size;
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fin.video_path], { encoding: 'utf8' });
log('PROJECT_DIR:', (await api(`/api/projects/${project.id}`)).project?.id);
log('VIDEO:', fin.video_path);
log('size:', (sz / 1024 / 1024).toFixed(2), 'MB | duration:', parseFloat(probe.stdout).toFixed(1), 's | total wall:', ((Date.now() - t0) / 60000).toFixed(1), 'min');
clearTimeout(timer); ws.close(); srv.kill();
log('PASS ✅');
process.exit(0);
