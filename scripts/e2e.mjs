// End-to-end smoke test: boot server, create a short project, run pipeline, verify MP4.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import WebSocket from 'ws';

const TOPIC = process.argv[2] || 'Lợi ích của việc đọc sách mỗi ngày. Đọc sách giúp mở rộng kiến thức. Đọc sách giúp giảm căng thẳng. Hãy bắt đầu thói quen đọc sách ngay hôm nay.';
const VIDEO_DURATION = parseInt(process.argv[3] || '18', 10);
const TIMEOUT_MS = parseInt(process.argv[4] || '420000', 10);

function log(...a) { console.log('[e2e]', ...a); }

const srv = spawn('node', ['src/server.js'], { env: { ...process.env, AVS_PORT: '0', AVS_DEBUG: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let base = null;
const ready = new Promise((res) => {
  srv.stdout.on('data', (d) => {
    const s = d.toString(); process.stdout.write('  ' + s);
    const m = s.match(/AVS_READY (http:\/\/\S+)/);
    if (m) { base = m[1]; res(); }
  });
  srv.stderr.on('data', (d) => process.stderr.write('  ! ' + d.toString()));
});

const api = (path, opts) => fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then((r) => r.json());
const fail = (msg) => { console.error('[e2e] FAIL:', msg); srv.kill(); process.exit(1); };

const timer = setTimeout(() => fail('timeout'), TIMEOUT_MS);

await ready;
log('server at', base);

// AVS_CFG_JSON: extra config merged LAST — lets sandbox drivers exercise any lane
// (overlay, sound design, consistent scenes…) without editing this file.
let extraCfg = {};
try { if (process.env.AVS_CFG_JSON) extraCfg = JSON.parse(process.env.AVS_CFG_JSON); } catch { log('bad AVS_CFG_JSON — ignored'); }
const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({
  topic: TOPIC,
  config: { aspectRatio: process.env.AVS_AR || '9:16', videoDuration: VIDEO_DURATION, sceneDuration: 6, enableSubtitles: true,
    subtitleColor: '#F7B500', subtitleFontSize: 80, richAnimation: true, autoConcat: true, renderMode: 'screenshot',
    visualMode: process.env.AVS_MODE || 'animation', theme: process.env.AVS_THEME || 'neon-tech',
    fps: parseInt(process.env.AVS_FPS || '30', 10), watermarkText: 'ai video studio',
    parallelTTS: true, ttsConcurrency: 4, renderConcurrency: parseInt(process.env.AVS_RC || '3', 10),
    ...extraCfg },
}) });
log('project', project.id);

const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
const done = new Promise((res, rej) => {
  ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', projectId: project.id })));
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.type === 'step') log('STEP', m.step, m.state, m.detail || '');
    else if (m.type === 'op') log('  op:', m.text);
    else if (m.type === 'scene') log('  scene', m.idx, m.status, m.duration ? `(${m.duration.toFixed(1)}s)` : '');
    else if (m.type === 'done') res(m);
    else if (m.type === 'error') rej(new Error(m.msg));
  });
});

await api(`/api/projects/${project.id}/start`, { method: 'POST', body: JSON.stringify({}) });
log('pipeline started…');

try {
  await done;
} catch (e) { fail('pipeline error: ' + e.message); }

const { project: fin, scenes } = await api(`/api/projects/${project.id}`);
log('scenes:', scenes.length, '| status:', fin.status);
if (!fin.video_path) fail('no video_path');
if (!existsSync(fin.video_path)) fail('video file missing: ' + fin.video_path);
const sz = statSync(fin.video_path).size;
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fin.video_path], { encoding: 'utf8' });
const dur = parseFloat(probe.stdout.trim());
log('VIDEO:', fin.video_path);
log('size:', (sz / 1024 / 1024).toFixed(2), 'MB | duration:', dur.toFixed(1), 's | thumb:', fin.thumb_path && existsSync(fin.thumb_path) ? 'OK' : 'missing');

clearTimeout(timer);
ws.close(); srv.kill();
if (sz < 10000 || dur < 3) fail('video too small/short');
log('PASS ✅');
process.exit(0);
