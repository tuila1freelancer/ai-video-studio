import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AvsClient } from '../packages/avs-kit/src/sdk.js';
import { createMcpServer } from '../packages/avs-kit/src/mcp-server.js';

// The whole lane, as an agent meets it: a real server process in SERVER MODE, a real token minted
// the way the owner would mint one, and the kit driving it over HTTP. The in-process tests cover the
// routes; this covers the things only a real boot has — the mode switch, the token, the refusal an
// unauthenticated caller gets, and the fact that all of it survives being started by a stranger.
//
// Control plane only: no render, no provider, no money. A real video is `npm run test:e2e`.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE = process.execPath;
const dataDir = mkdtempSync(join(tmpdir(), 'avs-agent-e2e-'));
const env = { ...process.env, AVS_DATA_DIR: dataDir, TOOLS_LICENSE_BYPASS: '1' };

const minted = execFileSync(NODE, [join(ROOT, 'scripts', 'token.mjs'), 'create', '--name', 'e2e', '--scopes', 'read,produce'], { env, encoding: 'utf8' });
const TOKEN = /avs_[A-Za-z0-9_-]+/.exec(minted)?.[0];

let child;
const url = await new Promise((resolve, reject) => {
  child = spawn(NODE, [join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...env, AVS_MODE: 'server', AVS_PORT: '0', AVS_DEBUG: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const onData = (buf) => {
    out += String(buf);
    const m = /AVS_READY (http:\/\/\S+)/.exec(out);
    if (m) resolve(m[1]);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => reject(new Error(`server exited early (${code})\n${out.slice(-1500)}`)));
  setTimeout(() => reject(new Error(`no AVS_READY\n${out.slice(-1500)}`)), 30_000).unref();
});

test.after(() => { try { child.kill(); } catch { /* already gone */ } });

test('the token the owner minted is the only way in', async () => {
  assert.match(TOKEN, /^avs_tok/, 'the CLI printed a token');
  const anonymous = new AvsClient({ url });
  const open = await anonymous.health();
  assert.equal(open.mode, 'server', 'health stays open — a launcher and a container poll it');

  let refused;
  try { await anonymous.projects(); } catch (e) { refused = e; }
  assert.equal(refused.code, 'token_required');
  assert.equal(refused.exitCode, 3, 'a configuration problem, not something to retry');

  const avs = new AvsClient({ url, token: TOKEN });
  assert.ok(Array.isArray((await avs.projects()).projects));
});

test('an agent produces, retries safely, and is refused what its token cannot do', async () => {
  const avs = new AvsClient({ url, token: TOKEN });
  const { channels } = await avs.channels();
  const channelId = channels[0].id;

  const first = await avs.createProject({ topic: 'an end-to-end topic from an agent', channelId, clientRef: 'e2e-1' });
  assert.equal(first.project.channel_id, channelId);
  const retry = await avs.createProject({ topic: 'an end-to-end topic from an agent', channelId, clientRef: 'e2e-1' });
  assert.equal(retry.project.id, first.project.id);
  assert.equal(retry.reused, true, 'the retry cost nothing and created nothing');

  const verdict = await avs.verdict(first.project.id);
  assert.equal(verdict.publishable, false);
  assert.ok(verdict.reasons.some((r) => r.code === 'project.not_done'));

  // read+produce, not publish: the scope map refuses before the platform ever hears about it.
  let denied;
  try { await avs.publish(first.project.id, { privacy: 'private' }); } catch (e) { denied = e; }
  assert.equal(denied.code, 'scope_denied');

  // …and not admin either.
  let notAdmin;
  try { await avs.post('/ops/pause', { reason: 'should not be allowed' }); } catch (e) { notAdmin = e; }
  assert.equal(notAdmin.code, 'scope_denied');
  assert.equal((await avs.ops()).ops.state, 'running', 'the queue was not touched');
});

test('the durable feed carries the agent name that asked', async () => {
  const avs = new AvsClient({ url, token: TOKEN });
  const head = await avs.events({});
  const { channels } = await avs.channels();
  const { project } = await avs.createProject({ topic: 'a topic that produces a journal line', channelId: channels[0].id, clientRef: 'e2e-2' });
  await avs.startProject(project.id);
  // The enqueue line is written by the route that queued it, under this token's name.
  const deadline = Date.now() + 10_000;
  let seen = [];
  while (Date.now() < deadline && !seen.length) {
    const feed = await avs.events({ after: head.lastId, project: project.id, wait: 3 });
    seen = feed.events;
  }
  assert.ok(seen.length, 'the feed showed the run starting');
  assert.ok(seen.every((e) => e.projectId === project.id));
  assert.ok(seen.some((e) => String(e.actor || '').startsWith('token:')), 'and it says which token asked');
  await avs.stopProject(project.id);
});

test('an MCP host drives the same server through the same token', async () => {
  const mcp = createMcpServer(new AvsClient({ url, token: TOKEN }), { name: 'avs', version: 'e2e' });
  const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(listed.result.tools.length >= 15);
  const called = await mcp.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'avs_video_create', arguments: { topic: 'a video an MCP host asked for', clientRef: 'e2e-mcp-1', start: false } },
  });
  const body = JSON.parse(called.result.content[0].text);
  assert.ok(body.project.id);
  const publish = await mcp.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'avs_video_publish', arguments: { projectId: body.project.id } },
  });
  assert.equal(publish.result.isError, true);
  assert.equal(JSON.parse(publish.result.content[0].text).code, 'scope_denied', 'the host is told why, not just that it failed');
});
