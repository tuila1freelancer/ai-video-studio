import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import * as DB from '../src/db/index.js';
import { hooksFor, signBody, notifyWebhooks } from '../src/ops/webhooks.js';

test('a hook only hears the kinds it asked for', () => {
  const hooks = [
    { url: 'https://a.example', kinds: ['job.settled'] },
    { url: 'https://b.example', kinds: [] },
    { url: 'https://c.example', kinds: ['project.published'], active: false },
    { url: '', kinds: [] },
  ];
  assert.deepEqual(hooksFor('job.settled', hooks).map((h) => h.url), ['https://a.example', 'https://b.example']);
  assert.deepEqual(hooksFor('project.published', hooks).map((h) => h.url), ['https://b.example'], 'an inactive hook hears nothing');
  assert.deepEqual(hooksFor('anything', []), []);
});

test('the signature is over the exact bytes sent', () => {
  const body = JSON.stringify({ event: 'x', at: 1 });
  assert.equal(signBody('s3cret', body), `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`);
  assert.notEqual(signBody('s3cret', body), signBody('other', body));
});

test('a delivery arrives signed, and a dead receiver never reaches the caller', async () => {
  const seen = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { seen.push({ headers: req.headers, body }); res.writeHead(200).end('ok'); });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${receiver.address().port}/hook`;
  DB.setSetting('webhooks', [
    { url, secret: 'top', kinds: ['job.settled'], active: true },
    { url: 'http://127.0.0.1:1/never', secret: '', kinds: ['job.settled'], active: true },
  ]);
  try {
    assert.equal(notifyWebhooks('job.settled', { projectId: 'p1', status: 'done' }), 2);
    assert.equal(notifyWebhooks('project.published', {}), 0, 'kinds are respected');
    const deadline = Date.now() + 3000;
    while (!seen.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers['x-avs-event'], 'job.settled');
    assert.ok(seen[0].headers['x-avs-delivery']);
    assert.equal(seen[0].headers['x-avs-signature'], signBody('top', seen[0].body));
    assert.equal(JSON.parse(seen[0].body).data.projectId, 'p1');
  } finally {
    receiver.close();
    DB.setSetting('webhooks', []);
  }
});
