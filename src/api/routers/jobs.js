// The durable job ledger: run history and cancel.
import * as DB from '../../db/index.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- durable job queue (run history + cancel) ----
  r.get('/jobs', (req, res) => {
    res.json({ jobs: DB.listJobs({ limit: Math.min(200, parseInt(req.query.limit, 10) || 50) }) });
  });
  r.get('/projects/:id/jobs', (req, res) => {
    res.json({ jobs: DB.listJobs({ projectId: req.params.id, limit: 50 }) });
  });
  r.post('/jobs/:id/cancel', (req, res) => {
    const n = DB.cancelJob(req.params.id); // queued only — a running job stops via /stop
    res.json({ ok: true, cancelled: n > 0 });
  });
}
