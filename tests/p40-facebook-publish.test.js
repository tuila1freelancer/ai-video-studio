// P40 — Facebook Page publishing + two UI holes: a toolbar button with no handler, and publish routes nothing could reach.
// Every network call is stubbed: nothing is uploaded anywhere.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import facebook from '../src/publish/facebook.js';
import { PUBLISHERS, getPublisher, publisherStatus } from '../src/publish/index.js';
import { setSetting } from '../src/db/index.js';

const VIDEO = join(mkdtempSync(join(tmpdir(), 'p40fb-')), 'v.mp4');
writeFileSync(VIDEO, Buffer.alloc(4096, 1));

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (msg) => ({ ok: false, status: 400, json: async () => ({ error: { message: msg } }), text: async () => msg });

function stub(handler) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body, headers: opts.headers || {} });
    return handler(String(url), opts, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test('P40: facebook joins the publisher registry beside youtube', () => {
  assert.ok(PUBLISHERS.facebook, 'registered');
  assert.equal(getPublisher('facebook').id, 'facebook');
  assert.ok(publisherStatus().some((p) => p.id === 'facebook'));
  assert.throws(() => getPublisher('tiktok'), /chưa hỗ trợ/);
});

test('P40: connect verifies the token against the Page and stores its real name', async () => {
  setSetting('publish', {});
  const s = stub(() => ok({ id: '123', name: 'Kênh Thử' }));
  try {
    const r = await facebook.connect({ pageId: '123', pageToken: 'tok' });
    assert.equal(r.pageName, 'Kênh Thử');
    assert.match(s.calls[0].url, /graph\.facebook\.com\/v[\d.]+\/123\?fields=id,name/);
    assert.equal(facebook.connected(), true);
  } finally { s.restore(); }
  // a bad token surfaces Facebook's own message, not "HTTP 400"
  setSetting('publish', {});
  const bad = stub(() => fail('Invalid OAuth access token.'));
  try {
    await assert.rejects(facebook.connect({ pageId: '1', pageToken: 'x' }), /Invalid OAuth access token/);
  } finally { bad.restore(); }
  await assert.rejects(facebook.connect({}), /Cần Page ID/);
});

test('P40: a vertical video goes up as a REEL, in start → bytes → finish order', async () => {
  setSetting('publish', { facebook: { pageId: '123', pageToken: 'tok', pageName: 'Kênh Thử' } });
  const s = stub((url) => (url.includes('rupload') ? ok({ success: true }) : ok({ video_id: '999' })));
  try {
    const out = await facebook.upload({ videoPath: VIDEO, description: 'mô tả', tags: ['ai', '#video'], privacy: 'public', aspectRatio: '9:16' });
    assert.equal(out.videoId, '999');
    assert.match(out.url, /facebook\.com\/reel\/999/);
    assert.equal(s.calls.length, 3, 'start, upload, finish');
    assert.match(s.calls[0].body.toString(), /upload_phase=start/);
    assert.match(s.calls[1].url, /rupload\.facebook\.com/);
    assert.equal(s.calls[1].headers.Authorization, 'OAuth tok');
    assert.equal(s.calls[1].headers.file_size, '4096', 'byte length is declared honestly');
    const finish = s.calls[2].body.toString();
    assert.match(finish, /upload_phase=finish/);
    assert.match(finish, /video_state=PUBLISHED/, 'privacy public → live');
    // form-encoding turns spaces into '+', so decode those back before reading the text
    assert.match(decodeURIComponent(finish.replace(/\+/g, ' ')), /mô tả\n\n#ai #video/, 'tags become hashtags under the description');
  } finally { s.restore(); }
});

test('P40: anything not vertical goes to the feed, and staging schedules instead of going live', async () => {
  setSetting('publish', { facebook: { pageId: '123', pageToken: 'tok' } });
  const s = stub(() => ok({ id: '777' }));
  try {
    const out = await facebook.upload({ videoPath: VIDEO, title: 'T', description: 'D', privacy: 'private', aspectRatio: '16:9' });
    assert.equal(out.videoId, '777');
    assert.equal(out.scheduled, true, 'a non-public publish is never instantly live');
    assert.match(s.calls[0].url, /\/123\/videos$/);
    const form = s.calls[0].body;
    assert.equal(form.get('published'), 'false');
    assert.ok(+form.get('scheduled_publish_time') > Math.floor(Date.now() / 1000) + 600, 'at least 10 minutes out');
  } finally { s.restore(); }
});

test('P40: publishing without a connected Page fails loudly, and a failed first comment never fails the post', async () => {
  setSetting('publish', {});
  await assert.rejects(facebook.upload({ videoPath: VIDEO }), /Chưa kết nối/);

  setSetting('publish', { facebook: { pageId: '123', pageToken: 'tok' } });
  const s = stub((url) => (url.includes('/comments') ? fail('Comment blocked') : ok({ id: '777' })));
  try {
    const out = await facebook.upload({ videoPath: VIDEO, privacy: 'public', aspectRatio: '16:9', firstComment: 'link nè' });
    assert.equal(out.videoId, '777', 'the video is published even though the comment failed');
  } finally { s.restore(); setSetting('publish', {}); }
});

test('P40: the audit holes are closed — the folder button works and publishing is reachable', () => {
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /\$\('#btnOpenFolder'\)\?\.addEventListener\('click'/, 'the toolbar button finally does something');
  assert.match(studio, /publishToFacebook/, 'a second destination is offered');
  assert.match(sourceOf('src/api/routes.js'), /'\/projects\/:id\/open'/, 'reveal-in-Finder route');
  assert.match(sourceOf('src/api/routes.js'), /'\/publish\/facebook\/connect'/);
  const settings = sourceOf('public/js/features/settings.js');
  assert.match(settings, /pubFbConnect/, 'the publish section is wired');
  assert.match(settings, /loadPublishStatus/, 'and reports what is connected');
});
