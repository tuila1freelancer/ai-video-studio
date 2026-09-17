// Diagnostics bundle, the persistent per-run journal (P32), the tasks feed and the cost meter.
import * as DB from '../../db/index.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- self-serve diagnostics bundle (masked, P14) ----
  r.get('/projects/:id/diagnostics', async (req, res) => {
    try {
      const { buildDiagnostics } = await import('../../pipeline/diagnostics.js');
      res.json(buildDiagnostics(req.params.id));
    } catch (e) { res.status(e.message === 'project not found' ? 404 : 500).json({ error: e.message }); }
  });

  // ---- P32 persistent per-run journal ("Nhật ký xử lý") ----
  r.get('/projects/:id/journal', (req, res) => {
    const projectId = req.params.id;
    const jobId = req.query.job && req.query.job !== 'all' ? String(req.query.job) : null;
    const events = DB.listJournal({
      projectId, jobId,
      level: req.query.level ? String(req.query.level) : null,
      q: req.query.q ? String(req.query.q) : null,
      before: req.query.before ? parseInt(req.query.before, 10) : null,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 500,
    });
    const runs = DB.listJobs({ projectId, limit: 20 }).map((j) => ({
      id: j.id, kind: j.kind, status: j.status, attempts: j.attempts,
      created_at: j.created_at, started_at: j.started_at, finished_at: j.finished_at,
      durMs: j.started_at && j.finished_at ? j.finished_at - j.started_at : null,
    }));
    res.json({ events, runs });
  });
  // Global tasks feed: every running/queued/recent job across projects + system-lane rows.
  r.get('/tasks', (req, res) => {
    const rows = DB.listJobs({ limit: Math.min(100, parseInt(req.query.limit, 10) || 40) });
    const titles = DB.projectTitles(rows.map((j) => j.project_id));
    const jobs = rows.map((j) => ({ ...j, projectTitle: j.project_id ? (titles.get(j.project_id) || null) : null }));
    const sys = DB.listJournal({ sys: true, limit: 30 });
    res.json({ jobs, sys });
  });

  // ---- usage / cost meter (estimates, labeled "ước tính") ----
  r.get('/usage', (req, res) => {
    if (req.query.projectId) return res.json({ usage: DB.usageForProject(String(req.query.projectId)) });
    res.json({ summary: DB.usageSummary({ limit: Math.min(100, parseInt(req.query.limit, 10) || 30) }) });
  });
}
