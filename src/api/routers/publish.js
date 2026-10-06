// Publishing: YouTube OAuth, the Facebook Page registry, captions, per-project publishes.
import { existsSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { assertPublishAllowed, publishPolicy } from '../../publish/policy.js';
import { recordQuota } from '../../publish/quota.js';
import { projectVerdict } from '../services/verdict.js';
import { jlog } from '../../pipeline/journal.js';
import { logger } from '../../util/log.js';
import { m, tp } from '../../i18n/t.js';
import { publisherStatus, getPublisher } from '../../publish/index.js';
import { chat, llmEnabled } from '../../providers/llm.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- publisher (B9 scaffold): OAuth loopback + manual publish (staging default) ----
  r.get('/publish/status', async (req, res) => {
    res.json({ platforms: publisherStatus() });
  });
  r.post('/publish/youtube/auth-url', async (req, res) => {
    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/api/publish/youtube/callback`;
      res.json({ url: getPublisher('youtube').authUrl({ clientId: req.body?.clientId, clientSecret: req.body?.clientSecret, redirectUri }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/publish/youtube/callback', async (req, res) => {
    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/api/publish/youtube/callback`;
      await getPublisher('youtube').exchangeCode(String(req.query.code || ''), redirectUri);
      res.send('<meta charset="utf-8"><body style="font-family:sans-serif;background:#0b1020;color:#eaf2ff;display:grid;place-items:center;height:100vh"><div>'
        + m('✅ Đã kết nối YouTube — bạn có thể đóng tab này.') + '</div></body>');
    } catch (e) { res.status(400).send(tp`OAuth lỗi: ${e.message}`); }
  });
  // AI post caption (P42 — reference `/publish/generate-caption`). A YouTube description is not
  // a Facebook caption: this writes the SHORT hook-first post copy for the platform, from the
  // narration the video actually contains rather than from its title.
  r.post('/publish/generate-caption', async (req, res) => {
    try {
      const p = DB.getProject(req.body?.projectId || '');
      if (!p) return res.status(404).json({ error: 'not found' });
      const ai = DB.aiSettings();
      if (!llmEnabled(ai.llm)) return res.status(400).json({ error: 'chưa bật LLM trong AI Setting' });
      const platform = ['facebook', 'youtube', 'tiktok'].includes(req.body?.platform) ? req.body.platform : 'facebook';
      const script = DB.getScenes(p.id).map((s) => (s.voice_text || '').trim()).filter(Boolean).join('\n').slice(0, 5000);
      const reply = await chat([
        { role: 'system', content: `You write short social captions for ${platform}. Reply with the caption text ONLY — no quotes, no preamble, no markdown.` },
        { role: 'user', content: `Video title: "${p.title || p.topic}"\n\nWhat the video actually says:\n<<<\n${script}\n>>>\n\nWrite the ${platform} caption in the SAME LANGUAGE as the narration: a hook in the first line (that is all most people see), 2-4 short lines of real substance drawn from the script above, then 3-5 hashtags. Never promise anything the script does not deliver. No emoji spam — two at most.` },
      ], { temperature: 0.8, maxTokens: 700, llm: ai.llm });
      const caption = String(reply || '').trim().replace(/^["']|["']$/g, '');
      if (!caption) return res.status(502).json({ error: 'model không trả về caption' });
      const md = p.metadata || {};
      DB.updateProject(p.id, { metadata: { ...md, captions: { ...(md.captions || {}), [platform]: caption } } });
      res.json({ platform, caption });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Facebook Page connect/disconnect — a pasted Page access token, verified against the Page
  // (P40). No OAuth dance: this is a desktop tool and the reference app works the same way.
  r.post('/publish/facebook/connect', async (req, res) => {
    try {
      res.json(await getPublisher('facebook').connect(req.body || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Facebook Page registry + token health (P42). A Page token expires; without this a silent
  // expiry just looks like "publishing broke".
  r.get('/publish/pages', async (req, res) => {
    res.json({ pages: getPublisher('facebook').listPages() });
  });
  r.post('/publish/pages/:pageId/select', async (req, res) => {
    try {
      res.json(getPublisher('facebook').selectPage(req.params.pageId));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/publish/pages/:pageId', async (req, res) => {
    try {
      res.json(getPublisher('facebook').removePage(req.params.pageId));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/publish/pages/:pageId/check', async (req, res) => {
    try {
      res.json(await getPublisher('facebook').checkToken(req.params.pageId));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/publish/pages/:pageId/extend', async (req, res) => {
    try {
      res.json(await getPublisher('facebook').extendToken({ ...(req.body || {}), pageId: req.params.pageId }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Which projects already went out — so the grid can badge them instead of the user guessing.
  r.get('/publish/published-ids', (req, res) => res.json({ ids: DB.publishedProjectIds() }));

  r.post('/publish/facebook/disconnect', async (req, res) => {
    try {
      res.json(getPublisher('facebook').disconnect());
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Manual publish — an EXPLICIT user action; privacy defaults to 'private' (staging)
  r.post('/projects/:id/publish', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      if (!p.video_path || !existsSync(p.video_path)) return res.status(400).json({ error: 'video chưa render xong' });
      const pub = getPublisher(req.body?.platform || 'youtube');
      if (!pub.connected()) return res.status(400).json({ error: 'chưa kết nối OAuth — vào Cài đặt → Đăng video' });
      // The channel's own rules, checked before anything is uploaded: how public, how many a day,
      // whether the verdict must pass, and whether the platform still has quota for it.
      const policy = publishPolicy(DB.channelOf(p.id));
      const verdict = policy.requireVerdict && !req.body?.force ? await projectVerdict(p.id, { vision: false }) : null;
      const { privacy } = assertPublishAllowed({
        projectId: p.id, platform: pub.id, privacy: req.body?.privacy, force: req.body?.force === true, verdict,
      });
      if (req.body?.force === true) {
        jlog(p.id, { kind: 'publish', level: 'warn', msg: m('⚠️ Đăng bỏ qua kiểm định theo yêu cầu (force)') });
      }
      const md = p.metadata || {};
      const recId = DB.recordPublish({ projectId: p.id, platform: pub.id, privacy });
      const out = await pub.upload({
        // a platform-shaped caption (P42) outranks the generic description when one was written
        // P43: a caption/title typed in the publish dialog is the user's final word — it outranks
        // the stored platform caption, which outranks the generic description.
        videoPath: p.video_path,
        title: String(req.body?.title || '').trim() || md.title || p.title,
        description: String(req.body?.caption || '').trim() || md.captions?.[pub.id] || md.description || '',
        tags: (md.platforms?.[pub.id]?.tags || md.platforms?.youtube?.tags || md.hashtags || []).map((t) => String(t).replace(/^#/, '')),
        privacy, thumbPath: p.thumb_path && existsSync(p.thumb_path) ? p.thumb_path : null,
        // Facebook picks reels vs feed video from the shape, and can pin a first comment.
        aspectRatio: p.aspect_ratio,
        scheduledAt: Number.isFinite(+req.body?.scheduledAt) && +req.body.scheduledAt > 0 ? +req.body.scheduledAt : null,
        firstComment: String(req.body?.firstComment || md.pinnedComment || '').trim(),
        onLog: (m) => logger.info(m, { projectId: p.id }),
      });
      DB.settlePublish(recId, { status: 'done', videoId: out.videoId, url: out.url });
      recordQuota({ projectId: p.id, channelId: p.channel_id, platform: pub.id, operation: 'videos.insert' });
      res.json({ ok: true, ...out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.get('/projects/:id/publishes', (req, res) => res.json({ publishes: DB.listPublishes(req.params.id) }));
}
