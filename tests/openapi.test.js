import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOpenApi, toExpressPath } from '../src/api/spec/index.js';
import { OPERATIONS } from '../src/api/spec/operations.js';
import { codeFor } from '../src/core/api-codes.js';

const pinned = new Set(JSON.parse(readFileSync(new URL('./fixtures/route-table.json', import.meta.url), 'utf8')));
const doc = buildOpenApi({ version: 'test' });

test('every documented operation is a route the router actually mounts', () => {
  const missing = Object.keys(OPERATIONS)
    .map((key) => { const [m, p] = key.split(' '); return `${m} ${toExpressPath(p)}`; })
    .filter((row) => !pinned.has(row));
  assert.deepEqual(missing, [], 'the document promises a route that does not exist');
});

test('the document says what a token needs, and how a refusal reads', () => {
  assert.equal(doc.openapi, '3.1.0');
  assert.deepEqual(doc.security, [{ bearer: [] }]);
  assert.equal(doc.paths['/health'].get['x-avs-scope'], null, 'health is open — the launcher polls it');
  assert.equal(doc.paths['/projects'].get['x-avs-scope'], 'read');
  assert.equal(doc.paths['/projects'].post['x-avs-scope'], 'produce');
  assert.equal(doc.paths['/projects/{id}/publish'].post['x-avs-scope'], 'publish');
  assert.equal(doc.paths['/ops/pause'].post['x-avs-scope'], 'admin');
  assert.ok(doc.paths['/projects'].post.responses[401], 'a guarded route documents its 401');
  assert.equal(doc.components.schemas.Error.required.includes('code'), true);
});

test('a path parameter is declared for every {placeholder}', () => {
  for (const [path, methods] of Object.entries(doc.paths)) {
    const names = (path.match(/\{(\w+)\}/g) || []).map((s) => s.slice(1, -1));
    for (const [method, op] of Object.entries(methods)) {
      for (const name of names) {
        assert.ok((op.parameters || []).some((p) => p.in === 'path' && p.name === name),
          `${method.toUpperCase()} ${path} does not declare ${name}`);
      }
    }
  }
});

test('every code the document names is one the API can actually produce', () => {
  const named = new Set(Object.values(OPERATIONS).flatMap((op) => op.codes || []));
  const producible = new Set([
    'not_found', 'forbidden', 'token_required', 'scope_denied', 'gate_not_at_scenes', 'video_not_ready',
    'publish_not_connected', 'input_no_topic', 'suggestion_not_found', 'channel_not_found', 'channel_denied',
    'idempotency_key_reused', 'license_required', 'bad_request', 'conflict', 'internal',
  ]);
  for (const code of named) assert.ok(producible.has(code), `${code} is documented but nothing raises it`);
  // and the fallbacks the edge produces are in that same vocabulary
  assert.ok(producible.has(codeFor('anything at all', 404)));
  assert.ok(producible.has(codeFor('anything at all', 409)));
});
