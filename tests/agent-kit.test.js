import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';
import { AvsClient, AvsError } from '../packages/avs-kit/src/sdk.js';
import { isTemporary } from '../packages/avs-kit/src/errors.js';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function engine() {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('a refusal becomes a decision, not a string to parse', () => {
  const denied = new AvsError('nope', { code: 'scope_denied', status: 403 });
  assert.equal(denied.retryable, false);
  assert.equal(denied.exitCode, 3);
  const limited = new AvsError('slow down', { code: 'rate_limited', status: 429 });
  assert.equal(limited.retryable, true);
  assert.equal(limited.exitCode, 4);
  assert.equal(isTemporary(limited), true);
  const broke = new AvsError('no', { code: 'budget_exceeded', status: 402 });
  assert.equal(broke.exitCode, 5);
  assert.equal(isTemporary(broke), true, 'a cap is "not now", not "not like this"');
  assert.equal(new AvsError('x', { code: 'verdict_failed', status: 409 }).exitCode, 2);
});

test('the kit drives the engine end to end, on the control plane', async () => {
  const { server, url } = await engine();
  const ch = DB.createChannel({ name: 'Kit' });
  const avs = new AvsClient({ url, channel: ch.id });
  try {
    const health = await avs.health();
    assert.equal(health.ok, true);
    assert.equal(health.mode, 'desktop');

    const { channels } = await avs.channels();
    assert.ok(channels.some((c) => c.id === ch.id));

    // Create twice under one reference: the second call must not make a second video.
    const first = await avs.createProject({ topic: 'the kit creates exactly one video', clientRef: 'kit-run-1' });
    const again = await avs.createProject({ topic: 'the kit creates exactly one video', clientRef: 'kit-run-1' });
    assert.equal(again.project.id, first.project.id);
    assert.equal(first.project.channel_id, ch.id, 'the channel came from the client, not the window');

    const { projects } = await avs.projects({ channel: ch.id });
    assert.deepEqual(projects.map((p) => p.id), [first.project.id]);

    const verdict = await avs.verdict(first.project.id);
    assert.equal(verdict.publishable, false, 'nothing has been rendered yet');
    assert.ok(verdict.reasons.some((r) => r.code === 'project.not_done'));

    const ops = await avs.pause('kit test');
    assert.equal(ops.ops.state, 'paused');
    assert.equal((await avs.ops()).ops.reason, 'kit test');
    await avs.resume();

    // The feed: subscribe, make something happen, read it back from the cursor.
    const head = await avs.events({});
    DB.insertJournal({ project_id: first.project.id, job_id: null, ts: Date.now(), level: 'info', stage: null, scene_idx: null, kind: 'status', msg: 'agent đang xem', data: null, actor: 'token:kit' });
    const feed = await avs.events({ after: head.lastId, project: first.project.id });
    assert.deepEqual(feed.events.map((e) => e.msg), ['agent đang xem']);

    let missing;
    try { await avs.project('no-such-project'); } catch (e) { missing = e; }
    assert.equal(missing.code, 'not_found');
    assert.equal(missing.exitCode, 3);
  } finally {
    server.close();
    await DB.setSetting('ops', { state: 'running' });
  }
});

test('waitFor returns the moment a project reaches a state it was told to wait for', async () => {
  const { server, url } = await engine();
  const avs = new AvsClient({ url });
  try {
    const p = DB.createProject({ title: 'w', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
    setTimeout(() => DB.updateProject(p.id, { status: 'done' }), 150);
    const settled = await avs.waitFor(p.id, { states: ['done'], timeoutMs: 8000, pollMs: 100 });
    assert.equal(settled.status, 'done');

    DB.updateProject(p.id, { status: 'running' });
    let timedOut;
    try { await avs.waitFor(p.id, { states: ['done'], timeoutMs: 300, pollMs: 100 }); } catch (e) { timedOut = e; }
    assert.equal(timedOut.code, 'wait_timeout');
  } finally { server.close(); }
});

test('the MCP server speaks the protocol, and a refusal is a result rather than a crash', async () => {
  const { server, url } = await engine();
  const { createMcpServer } = await import('../packages/avs-kit/src/mcp-server.js');
  const mcp = createMcpServer(new AvsClient({ url }), { name: 'avs', version: 'test' });
  try {
    const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'avs');
    assert.ok(init.result.capabilities.tools, 'it offers tools');
    assert.match(init.result.instructions, /clientRef/, 'the host is told the rule that prevents double spending');

    assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification gets no answer');

    const listed = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = listed.result.tools.map((t) => t.name);
    for (const expected of ['avs_health', 'avs_video_create', 'avs_video_verdict', 'avs_video_publish', 'avs_journal_tail', 'avs_ops']) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
    for (const tool of listed.result.tools) {
      assert.ok(tool.description.length > 20, `${tool.name} needs a description an agent can act on`);
      assert.equal(tool.inputSchema.type, 'object');
    }

    const health = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'avs_health', arguments: {} } });
    assert.equal(JSON.parse(health.result.content[0].text).ok, true);

    const made = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'avs_video_create', arguments: { topic: 'a video an agent asked for', clientRef: 'mcp-1', start: false } } });
    const body = JSON.parse(made.result.content[0].text);
    assert.ok(body.project.id);
    const twice = await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'avs_video_create', arguments: { topic: 'a video an agent asked for', clientRef: 'mcp-1', start: false } } });
    assert.equal(JSON.parse(twice.result.content[0].text).reused, true, 'the same reference cannot make a second video');

    const missing = await mcp.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'avs_video_status', arguments: { projectId: 'nope' } } });
    assert.equal(missing.result.isError, true);
    assert.equal(JSON.parse(missing.result.content[0].text).code, 'not_found', 'the agent reads a code, not a stack');

    const unknown = await mcp.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'avs_nonsense', arguments: {} } });
    assert.equal(unknown.error.code, -32602);
    assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 8, method: 'ping' })).result && true, true);
  } finally { server.close(); }
});

test('the kit stays dependency-free, which is the promise that makes it installable anywhere', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../packages/avs-kit/', import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name)) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length >= 5, 'it found the kit');
  for (const file of files) {
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
        `${file.slice(root.length)} imports ${spec} — the kit may only use node: builtins and its own files`);
    }
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/await import\(\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'), `${file} dynamically imports ${spec}`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'declared dependencies would break the promise too');
});

test('the kit finds a running app by itself, on whichever OS it is installed', async () => {
  const { urlFiles, discoverUrl, DEFAULT_URL } = await import('../packages/avs-kit/src/discover.js');
  const home = '/Users/someone';
  const mac = urlFiles('darwin', {}, home);
  assert.ok(mac.includes(join(home, 'Library', 'Application Support', 'AI Video Studio', 'server.url')),
    'the macOS app writes it beside its data, not beside the bundle');
  const win = urlFiles('win32', { APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' }, home);
  assert.ok(win.some((p) => p.includes('Roaming') && p.endsWith(join('data', 'server.url'))));
  assert.ok(win.length >= 3, 'both names Electron may have used, plus the payload-relative one');
  assert.equal(urlFiles('darwin', { AVS_DATA_DIR: '/srv/avs' }, home)[0], join('/srv/avs', 'server.url'),
    'an explicit data directory is believed before any guess');

  // A real file, written the way the server writes it.
  const dir = mkdtempSync(join(tmpdir(), 'avs-url-'));
  writeFileSync(join(dir, 'server.url'), 'http://127.0.0.1:54321');
  assert.equal(discoverUrl('linux', { AVS_DATA_DIR: dir }), 'http://127.0.0.1:54321');
  // A damaged file is skipped rather than believed, and the search carries on down the list.
  writeFileSync(join(dir, 'server.url'), 'not a url at all');
  const next = discoverUrl('linux', { AVS_DATA_DIR: dir });
  assert.notEqual(next, 'not a url at all');
  assert.match(next, /^https?:\/\/\S+$/);
  rmSync(dir, { recursive: true, force: true });
  assert.match(DEFAULT_URL, /^http:\/\/127\.0\.0\.1:\d+$/, 'and with nothing to find, the old fixed port');

  // Two copies have run on this machine — an installed app and a checkout. The one that wrote
  // last is the one that is running; the other is a port nothing has listened on for a week.
  const older = join(mkdtempSync(join(tmpdir(), 'avs-old-')), 'server.url');
  const newer = join(mkdtempSync(join(tmpdir(), 'avs-new-')), 'server.url');
  writeFileSync(older, 'http://127.0.0.1:1111');
  writeFileSync(newer, 'http://127.0.0.1:2222');
  utimesSync(older, new Date(), new Date(Date.now() - 86_400_000));
  assert.equal(discoverUrl('linux', {}, [older, newer]), 'http://127.0.0.1:2222', 'freshest wins, not first');
  assert.equal(discoverUrl('linux', {}, [newer, older]), 'http://127.0.0.1:2222');
  rmSync(older, { force: true });
  rmSync(newer, { force: true });

  const client = new AvsClient({ url: 'http://example.test:9/' });
  assert.equal(client.base, 'http://example.test:9', 'an explicit url still wins over everything');
});
