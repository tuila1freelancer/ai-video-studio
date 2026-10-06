// Resume an interrupted project and wait for completion.
// Usage: node scripts/resume.mjs <projectId> [timeoutMs]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import WebSocket from 'ws';

const PROJECT_ID = process.argv[2];
const TIMEOUT_MS = parseInt(process.argv[3] || '5400000', 10);
if (!PROJECT_ID) { console.error('usage: node scripts/resume.mjs <projectId>'); process.exit(2); }

function log(...a) { console.log('[resume]', ...a); }

const srv = spawn('node', ['src/server.js'], { env: { ...process.env, AVS_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let base = null;
const ready = new Promise((res) => {
  srv.stdout.on('data', (d) => { const m = d.toString().match(/AVS_READY (http:\/\/\S+)/); if (m) { base = m[1]; res(); } });
  srv.stderr.on('data', (d) => process.stderr.write('  ! ' + d.toString()));
});
const api = (p, o) => fetch(base + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then((r) => r.json());
const fail = (m) => { console.error('[resume] FAIL:', m); srv.kill(); process.exit(1); };
setTimeout(() => fail('timeout'), TIMEOUT_MS);

await ready; log('server', base);
const { project, scenes } = await api('/api/projects/' + PROJECT_ID);
if (!project) fail('project not found');
log('project:', project.title.slice(0, 40), '| scenes:', scenes.length, '| already rendered:', scenes.filter((s) => s.video_path).length);

const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
const done = new Promise((res, rej) => {
  ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', projectId: PROJECT_ID })));
  let n = 0;
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.type === 'step') log('STEP', m.step, m.state, m.detail || '');
    else if (m.type === 'scene' && m.status === 'rendered') { n++; if (n % 10 === 0) log(n, 'scenes re-rendered'); }
    else if (m.type === 'done') res(m);
    else if (m.type === 'error') rej(new Error(m.msg));
  });
});
await api(`/api/projects/${PROJECT_ID}/resume`, { method: 'POST', body: '{}' });
log('resumed…');
try { await done; } catch (e) { fail(e.message); }

const { project: fin, scenes: finScenes } = await api('/api/projects/' + PROJECT_ID);
if (!fin.video_path || !existsSync(fin.video_path)) fail('no final video');
const sz = statSync(fin.video_path).size;
const dur = parseFloat(spawnSync('vendor/ffmpeg/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fin.video_path], { encoding: 'utf8' }).stdout.trim());
log('VIDEO:', fin.video_path);
log('size:', (sz / 1048576).toFixed(1), 'MB | duration:', (dur / 60).toFixed(1), 'min');
ws.close(); srv.kill();
// Absolute thresholds break when the voice pace changes (HoaiMy reads faster than 'say').
// The real contract: final duration covers ≥ 92% of the narration material.
const expect = (finScenes || []).reduce((a, s) => a + (s.duration || 0), 0);
const ok = expect > 0 ? dur >= expect * 0.92 : dur > 600;
log(`narration total: ${(expect / 60).toFixed(1)} min → ${ok ? 'PASS ✅' : 'FAIL (video is shorter than the narration)'}`);
process.exit(ok ? 0 : 1);
