// Assistant, topic suggestions, series, the content calendar and the ops dashboard.
import * as DB from '../../db/index.js';
import { suggestTopics } from '../services/topic-autopilot.js';
import { aiSettingsFor } from '../../core/config.js';
import { acceptSuggestion, scheduleSuggestion, buildSeries, planWeek } from '../services/assistant.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- trend autopilot + content calendar + ops dashboard ----
  // assistant preferences (trend packs, custom feeds, notify) — no secrets in this subtree
  r.get('/assistant/settings', (req, res) => res.json({ assistant: DB.getSetting('assistant', {}) || {} }));
  r.put('/assistant/settings', (req, res) => {
    const cur = DB.getSetting('assistant', {}) || {};
    const b = req.body || {};
    const next = { ...cur };
    if (Array.isArray(b.packs)) next.packs = b.packs.map(String).slice(0, 10);
    if (Array.isArray(b.feeds)) {
      next.feeds = b.feeds
        .filter((f) => f && /^https?:\/\//i.test(f.url || ''))
        .map((f) => ({ url: String(f.url).slice(0, 300), label: String(f.label || '').slice(0, 40) }))
        .slice(0, 12);
    }
    if (typeof b.notify === 'boolean') next.notify = b.notify;
    DB.setSetting('assistant', next);
    res.json({ ok: true, assistant: next });
  });
  r.post('/topics/suggest', async (req, res) => {
    try {
      const channel = DB.getChannel(DB.activeChannelId());
      // trend sources: global assistant settings, overridable per channel (config.assistant)
      const globalSrc = DB.getSetting('assistant', {}) || {};
      const chSrc = channel?.config?.assistant || {};
      const sources = { packs: chSrc.packs || globalSrc.packs || [], feeds: chSrc.feeds || globalSrc.feeds || [] };
      res.json(await suggestTopics({ channelId: channel?.id, niche: String(req.body?.niche || ''), count: Math.min(12, parseInt(req.body?.count, 10) || 8), ai: aiSettingsFor(channel), sources }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // suggestion history + owner decisions (accept is the ONLY route that starts a pipeline,
  // and only for the explicitly clicked suggestion)
  r.get('/topics/history', (req, res) => {
    const channel = DB.getChannel(DB.activeChannelId());
    res.json({ suggestions: DB.listSuggestions({
      channelId: req.query.all ? null : channel?.id,
      status: req.query.status || null,
      q: String(req.query.q || ''),
      limit: parseInt(req.query.limit, 10) || 200,
      before: req.query.before || null,
    }) });
  });
  r.post('/topics/:id/accept', async (req, res) => {
    try {
      res.json({ ok: true, ...acceptSuggestion(req.params.id, { config: req.body?.config || {}, title: req.body?.title || null }) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.post('/topics/:id/schedule', async (req, res) => {
    try {
      res.json({ ok: true, ...scheduleSuggestion(req.params.id, { dueAt: +req.body?.dueAt, config: req.body?.config || {}, title: req.body?.title || null }) });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  r.post('/topics/:id/dismiss', (req, res) => res.json({ ok: DB.setSuggestionStatus(req.params.id, 'dismissed') > 0 }));
  r.post('/topics/:id/restore', (req, res) => res.json({ ok: DB.setSuggestionStatus(req.params.id, 'suggested') > 0 }));
  // mini-series: LLM designs N connected episodes → persisted as pending suggestions (data only)
  r.post('/topics/series', async (req, res) => {
    try {
      const channel = DB.getChannel(DB.activeChannelId());
      res.json({ ok: true, ...(await buildSeries({
        suggestionId: req.body?.suggestionId || null,
        seed: req.body?.seed || '',
        episodes: req.body?.episodes,
        ai: aiSettingsFor(channel),
      })) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.get('/calendar', (req, res) => res.json({ slots: DB.listSlots() }));
  r.post('/calendar', (req, res) => {
    try {
      const channel = DB.getChannel(DB.activeChannelId());
      res.json({ slot: DB.addSlot({ channelId: channel?.id || null, topic: req.body?.topic, config: req.body?.config || {}, dueAt: +req.body?.dueAt }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/calendar/:id', (req, res) => {
    const ok = DB.cancelSlot(req.params.id) > 0;
    if (ok) { try { DB.restoreSuggestionBySlot(req.params.id); } catch { /* linkage is best-effort */ } }
    res.json({ ok });
  });
  r.put('/calendar/:id', (req, res) => {
    try {
      const fields = {};
      if (req.body?.config !== undefined) fields.config = req.body.config;
      if (req.body?.dueAt !== undefined) fields.dueAt = +req.body.dueAt;
      res.json({ ok: DB.updateSlot(req.params.id, fields) > 0 });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // recurring planning templates — inert windows; they never create projects by themselves
  r.get('/calendar/recurrences', (req, res) => {
    res.json({ recurrences: DB.listRecurrences(DB.activeChannelId()) });
  });
  r.post('/calendar/recurrences', (req, res) => {
    try {
      res.json({ recurrence: DB.addRecurrence({
        channelId: DB.activeChannelId(),
        weekday: req.body?.weekday, time: req.body?.time, config: req.body?.config || {},
      }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/calendar/recurrences/:id', (req, res) => res.json({ ok: DB.deleteRecurrence(req.params.id) > 0 }));
  // plan-my-week: fill the coming days with pending suggestions — SLOTS only, owner-confirmed
  r.post('/calendar/plan', async (req, res) => {
    try {
      const b = req.body || {};
      res.json({ ok: true, ...planWeek({
        days: Math.min(31, parseInt(b.days, 10) || 7),
        perDay: Math.min(5, parseInt(b.perDay, 10) || 1),
        times: Array.isArray(b.times) && b.times.length ? b.times.map(String) : ['08:00'],
        config: b.config || {},
        topicIds: Array.isArray(b.topicIds) && b.topicIds.length ? b.topicIds : null,
      }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/dashboard', (req, res) => {
    const projects = DB.listProjectSummaries();
    const byStatus = DB.projectCountsByStatus();
    // 7-day production pulse (local-midnight buckets, oldest first)
    const now = new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const bucket = (ts) => Math.min(6, Math.max(0, Math.floor((ts - day0) / 864e5)));
    const week = { createdByDay: Array(7).fill(0), doneByDay: Array(7).fill(0) };
    for (const p of projects) {
      if (p.created_at >= day0) week.createdByDay[bucket(p.created_at)]++;
      if (p.status === 'done' && p.updated_at >= day0) week.doneByDay[bucket(p.updated_at)]++;
    }
    // 30-day suggestion funnel — how many assistant ideas became videos
    const since30 = Date.now() - 30 * 864e5;
    const funnel = { suggested: 0, accepted: 0, scheduled: 0, dismissed: 0 };
    for (const s of DB.listSuggestions({ limit: 500 })) {
      if (s.created_at >= since30 && funnel[s.status] !== undefined) funnel[s.status]++;
    }
    const slots = DB.listSlots({ includeDone: false });
    res.json({
      projects: { total: projects.length, byStatus },
      jobs: DB.listJobs({ limit: 20 }),
      usage: DB.usageSummary({ limit: 10 }),
      calendar: slots.slice(0, 10),
      week, funnel, upcoming: slots.slice(0, 5),
    });
  });
}
