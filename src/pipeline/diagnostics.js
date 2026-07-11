// Self-serve diagnostics bundle — everything needed to understand "why did my video fail"
// in one JSON: dependency status, masked project config, the QC report, recent jobs and
// usage, and the last error with its classification. Everything passes maskSecrets (P14).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import * as DB from '../db/index.js';
import { depStatus } from '../config/paths.js';
import { maskSecrets } from '../util/secrets.js';
import { classifyError } from '../core/errors.js';
import { poolStats } from './governor.js';
import { usageTotals } from '../util/usage.js';
import { safeJson } from '../util/util.js';

export function buildDiagnostics(projectId) {
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const dir = DB.projectDirFor(projectId);
  const qcPath = join(dir, 'qc_report.json');
  const scenes = DB.getScenes(projectId);
  return maskSecrets({
    at: new Date().toISOString(),
    system: { platform: os.platform(), release: os.release(), cpus: os.cpus().length, node: process.version },
    deps: depStatus(),
    pools: poolStats(),
    sessionUsage: usageTotals(),
    project: {
      id: project.id, title: project.title, status: project.status, step: project.current_step,
      error: project.error || null,
      errorClass: project.error ? classifyError(project.error) : null,
      config: project.config || {},
      scenes: {
        total: scenes.length,
        byStatus: scenes.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {}),
        errors: scenes.filter((s) => s.error).map((s) => ({ idx: s.idx, error: s.error })).slice(0, 20),
      },
    },
    qcReport: existsSync(qcPath) ? safeJson(readFileSync(qcPath, 'utf8'), null) : null,
    jobs: DB.listJobs({ projectId, limit: 10 }),
    usage: DB.usageForProject(projectId),
  });
}
