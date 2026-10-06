// Resume driver for a sandboxed E2E project: boots the server on the SAME data dir, resumes
// the newest (or given) project, streams progress, verifies the final MP4. This is the
// no-fallback contract's second half — a loud codegen failure is retried by RESUMING, which
// regenerates exactly the scenes that carry no props.
//   AVS_DATA_DIR=/sandbox node scripts/e2e-resume.mjs [projectId] [timeoutMs]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import WebSocket from 'ws';

const PROJECT = process.argv[2] || '';
const TIMEOUT_MS = parseInt(process.argv[3] || '3600000', 10);
if (!process.env.AVS_DATA_DIR) { console.error('[e2e-resume] AVS_DATA_DIR is required'); process.exit(2); }

function log(...a) { console.log('[e2e-resume]', ...a); }

// AVS_HF_MODEL: the remedy the no-fallback contract leaves the user — before resuming, point the
// project's codegen at a stronger PRIMARY model (this is a config change the user would
// make in the UI, not a silent fallback). Applied via the DB before the server boots.
if (process.env.AVS_HF_MODEL) {
  const DB = await import('../src/db/index.js');
  const pr = PROJECT ? DB.getProject(PROJECT) : DB.listProjects()[0];
  if (pr) {
    const cfg = { ...(pr.config || {}), hyperframe: { ...(pr.config?.hyperframe || {}), model: process.env.AVS_HF_MODEL } };
    DB.updateProject(pr.id, { config: cfg });
    log(`project ${pr.id}: hyperframe.model → ${process.env.AVS_HF_MODEL}`);
  }
}
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
const fail = (msg) => { console.error('[e2e-resume] FAIL:', msg); srv.kill(); process.exit(1); };
const timer = setTimeout(() => fail('timeout'), TIMEOUT_MS);

await ready;
log('server at', base);
const { projects } = await api('/api/projects');
const project = PROJECT ? projects.find((p) => p.id === PROJECT) : projects[0];
if (!project) fail('no project found in sandbox');
log('resuming project', project.id, `(status ${project.status})`);

const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
const done = new Promise((res, rej) => {
  ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', projectId: project.id })));
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.type === 'step') log('STEP', m.step, m.state, m.detail || '');
    else if (m.type === 'op') log('  op:', m.text);
    else if (m.type === 'done') res(m);
    else if (m.type === 'error') rej(new Error(m.msg));
  });
});
await api(`/api/projects/${project.id}/resume`, { method: 'POST', body: JSON.stringify({}) });
try { await done; } catch (e) { fail('pipeline error: ' + e.message); }

const { project: fin } = await api(`/api/projects/${project.id}`);
if (!fin.video_path || !existsSync(fin.video_path)) fail('no final video');
const sz = statSync(fin.video_path).size;
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fin.video_path], { encoding: 'utf8' });
const dur = parseFloat(probe.stdout.trim());
log('VIDEO:', fin.video_path);
log('size:', (sz / 1024 / 1024).toFixed(2), 'MB | duration:', dur.toFixed(1), 's');
clearTimeout(timer); ws.close(); srv.kill();
if (sz < 10000 || dur < 3) fail('video too small/short');
log('PASS ✅');
process.exit(0);
