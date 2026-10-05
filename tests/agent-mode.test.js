import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { agentMode, setAgentMode } from '../src/ops/agent-mode.js';
import { authRequired } from '../src/api/middleware/auth.js';
import { resetUiSession, uiSessionToken } from '../src/ops/ui-session.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

test('agent access is off until the owner turns it on, and it survives a restart', () => {
  assert.deepEqual(agentMode(), { enabled: false, since: null });
  assert.equal(authRequired(), false, 'a desktop app with nobody to answer to asks for nothing');
  const on = setAgentMode({ enabled: true });
  assert.equal(on.enabled, true);
  assert.ok(on.since > 0);
  assert.equal(authRequired(), true, 'tokens are enforced on loopback too — that is the point');
  // Stored, not remembered: a fresh read of the settings row says the same thing.
  assert.equal(DB.getSetting('agent', {}).enabled, true);
  setAgentMode({ enabled: false });
  assert.equal(authRequired(), false);
});

test('with agent access on, an agent needs a token and the app window still gets in', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  setAgentMode({ enabled: true });
  resetUiSession();
  try {
    const anon = await fetch(`${base}/projects`);
    assert.equal(anon.status, 401);
    assert.equal((await anon.json()).code, 'token_required');

    // The window's own session, as the cookie the launcher handshake sets.
    const session = uiSessionToken();
    const asWindow = await fetch(`${base}/projects`, { headers: { Cookie: `avs_token=${session}` } });
    assert.equal(asWindow.status, 200, 'the owner is never locked out of their own app');

    const agent = DB.createApiToken({ name: 'an agent', scopes: ['read'] });
    const asAgent = await fetch(`${base}/projects`, { headers: { Authorization: `Bearer ${agent.token}` } });
    assert.equal(asAgent.status, 200);

    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.agent, true, 'a monitor can see the lane is open');
    assert.equal(health.ok, true, 'health itself stays open, as the launcher needs');
  } finally {
    setAgentMode({ enabled: false });
    resetUiSession();
    server.close();
  }
});

test('/boot says where this copy lives, so the panel can print a command that runs', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const { host } = await (await fetch(`${base}/boot`)).json();
    assert.equal(host.platform, process.platform);
    assert.equal(host.dist, false, 'a repository is not a shipped build');
    assert.ok(host.root.endsWith('ai-video-generation') || existsSync(join(host.root, 'package.json')));
    assert.ok(isAbsolute(host.dataDir), 'an absolute path, or it means nothing to a shell');
    assert.ok(host.node === null || isAbsolute(host.node));
    assert.ok(host.kit.mcp.endsWith(join('bin', 'avs-mcp.mjs')), 'the kit is in this tree, so it is named');
    assert.ok(existsSync(host.kit.mcp), 'and the path given is one that exists');

    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.host, undefined, '/health is open — nothing about this machine goes on it');

    // The interface seeds its /settings cache from this reply, so it must carry the same fields the
    // panel reads there — a seed missing them showed the switch off and the caps blank on every boot.
    const boot = await (await fetch(`${base}/boot`)).json();
    assert.deepEqual(Object.keys(boot.agent).sort(), ['enabled', 'since']);
    assert.equal(typeof boot.budget, 'object');
    const { sourceOf } = await import('./_source.mjs');
    const seeded = sourceOf('public/js/main.js');
    assert.match(seeded, /api\.seed\('\/settings', \{ settings: boot\.settings, uiLang: boot\.uiLang, agent: boot\.agent, budget: boot\.budget \}\)/);
  } finally { server.close(); }
});

test('the panel a person actually uses carries the switch, the tokens and the caps', async () => {
  const { indexHtml, sourceOf } = await import('./_source.mjs');
  const html = indexHtml();
  const modal = html.slice(html.indexOf('id="settingsModal"'), html.indexOf('id="srtModal"'));
  for (const id of ['setAgentOn', 'agentBox', 'agentTokens', 'btnAgentNew', 'agentCmd', 'agentWarn']) {
    assert.ok(modal.includes(`id="${id}"`), `the agent panel needs #${id}`);
  }
  for (const id of ['setBudVideo', 'setBudDay', 'setBudVideos', 'setBudHard']) {
    assert.ok(modal.includes(`id="${id}"`), `spending caps need #${id}`);
  }
  const js = sourceOf('public/js/features/settings.js');
  assert.match(js, /budget: budgetForSave\(\)/, 'the caps must travel with the rest of the save');
  // /settings answers with `agent` beside `settings`, not inside it. Reading it from the wrong
  // place showed the switch off on every reload, however the lane was actually set.
  assert.match(js, /const \{ settings, budget, agent \} = await api\.get\('\/settings'/);
  assert.match(js, /loadAgent\(agent\);/, 'the panel reads the block the server actually sends');
  assert.match(js, /claude mcp add avs -- \$\{q\(info\.node\)\} \$\{q\(info\.kit\.mcp\)\} --token \$\{token\}/,
    'the command printed for the owner is built from this machine, not from a README');
  assert.ok(!/--url/.test(js.slice(js.indexOf('mcpCommand'), js.indexOf('function renderCommand'))),
    'and it pins no URL: the port changes every launch');
});
