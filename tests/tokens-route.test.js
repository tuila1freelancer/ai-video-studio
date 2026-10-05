// The one HTTP route that hands out a token, and the three locks on it.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as DB from '../src/db/index.js';
import { setAgentMode } from '../src/ops/agent-mode.js';
import { resetUiSession, uiSessionToken } from '../src/ops/ui-session.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

/** The app, as the window reaches it: over loopback. */
async function boot() {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}/api` };
}

const post = (base, body, headers = {}) => fetch(`${base}/tokens`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('the window mints, lists and revokes — and the secret is shown exactly once', async () => {
  const { server, base } = await boot();
  try {
    const made = await (await post(base, { name: 'claude-code', scopes: ['read', 'produce'] })).json();
    assert.match(made.token.token, /^avs_tok[a-z0-9]+_/, 'a token a person made, not a system session');
    assert.deepEqual(made.token.scopes, ['read', 'produce']);

    const listed = await (await fetch(`${base}/tokens`)).json();
    const row = listed.tokens.find((t) => t.id === made.token.id);
    assert.ok(row, 'it is in the list');
    assert.ok(!JSON.stringify(row).includes(made.token.token.split('_')[2]), 'but its secret is not, ever again');
    assert.deepEqual(listed.scopes, DB.SCOPES, 'the interface is told what it may ask for');

    const gone = await fetch(`${base}/tokens/${made.token.id}`, { method: 'DELETE' });
    assert.equal((await gone.json()).ok, true);
    assert.equal(DB.verifyApiToken(made.token.token), null, 'a revoked token authenticates nothing');
  } finally { server.close(); }
});

test('an unknown scope is refused rather than quietly dropped', async () => {
  const { server, base } = await boot();
  try {
    const r = await post(base, { name: 'over-reaching', scopes: ['read', 'root'] });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'bad_request');
  } finally { server.close(); }
});

test('with agent access on, an agent holding admin still cannot mint itself a successor', async () => {
  const { server, base } = await boot();
  setAgentMode({ enabled: true });
  resetUiSession();
  try {
    const agent = DB.createApiToken({ name: 'an agent', scopes: ['admin'] });
    const asAgent = await post(base, { name: 'mine' }, { Authorization: `Bearer ${agent.token}` });
    assert.equal(asAgent.status, 403, 'admin reaches every other write, but not this one');
    assert.equal((await asAgent.json()).code, 'forbidden');

    const asWindow = await post(base, { name: 'from the window' }, { Cookie: `avs_token=${uiSessionToken()}` });
    assert.equal(asWindow.status, 200, 'the window is how the owner gets one at all');

    const listing = await (await fetch(`${base}/tokens`, { headers: { Cookie: `avs_token=${uiSessionToken()}` } })).json();
    assert.ok(!listing.tokens.some((t) => t.id.startsWith('sys')), 'the window never offers its own session for revoking');
    const itself = await fetch(`${base}/tokens/${DB.listApiTokens().find((t) => t.id.startsWith('sys')).id}`, {
      method: 'DELETE', headers: { Cookie: `avs_token=${uiSessionToken()}` },
    });
    assert.equal(itself.status, 403, 'nor can it be named directly');
  } finally {
    setAgentMode({ enabled: false });
    resetUiSession();
    server.close();
  }
});

test('a server deployment keeps the CLI: the route refuses even the right token', async () => {
  const { server, base } = await boot();
  process.env.AVS_MODE = 'server';
  try {
    const admin = DB.createApiToken({ name: 'deployer', scopes: ['admin'] });
    const r = await post(base, { name: 'mine' }, { Authorization: `Bearer ${admin.token}` });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'token_minting_disabled');
  } finally {
    delete process.env.AVS_MODE;
    server.close();
  }
});
