// Daily production journal — appends TODAY's real studio stats (from the live DB) to
// JOURNAL.md and commits it as tuila1freelancer. Everything written is genuine operational
// data: videos created/completed, job outcomes, metered AI usage, publishes.
// Scheduled via launchd (see scripts/install-journal-schedule.sh); idempotent per day —
// re-running replaces today's section instead of duplicating it.
// Usage: node scripts/journal.mjs [--dry-run]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOURNAL = join(ROOT, 'JOURNAL.md');
const DRY = process.argv.includes('--dry-run');

const GIT_NAME = 'tuila1freelancer';
const GIT_EMAIL = '62372475+tuila1freelancer@users.noreply.github.com';

const DB = await import(join(ROOT, 'src/db/index.js'));
const db = DB.default;

// local-midnight day window
const now = new Date();
const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// ---- collect the day's real numbers ------------------------------------------------
const created = db.prepare('SELECT COUNT(*) n FROM projects WHERE created_at >= ?').get(dayStart).n;
const doneRows = db.prepare("SELECT title FROM projects WHERE status='done' AND updated_at >= ? ORDER BY updated_at DESC").all(dayStart);
const scenesRendered = db.prepare(`SELECT COUNT(*) n FROM scenes s JOIN projects p ON p.id = s.project_id
  WHERE s.video_path IS NOT NULL AND p.updated_at >= ?`).get(dayStart).n;
const jobs = db.prepare(`SELECT status, COUNT(*) n FROM jobs WHERE finished_at >= ? GROUP BY status`).all(dayStart)
  .reduce((a, r) => { a[r.status] = r.n; return a; }, {});
const usage = db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(prompt_tokens),0) tin,
  COALESCE(SUM(completion_tokens),0) tout, COALESCE(SUM(chars),0) chars, COALESCE(SUM(est_cost),0) cost
  FROM provider_usage WHERE at >= ?`).get(dayStart);
const publishes = db.prepare(`SELECT COUNT(*) n FROM publish_targets WHERE at >= ? AND status='done'`).get(dayStart).n;
const calendarRuns = db.prepare(`SELECT COUNT(*) n FROM calendar_slots WHERE status='created' AND due_at >= ?`).get(dayStart).n;

const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));
const titles = doneRows.slice(0, 5).map((r) => `“${r.title}”`).join(' · ');

const lines = [
  `## ${dateStr}`,
  `- Videos: ${created} created · ${doneRows.length} completed${titles ? ` — ${titles}` : ''}`,
  `- Scenes with rendered clips (active projects): ${scenesRendered} · Jobs: ${jobs.done || 0} done / ${jobs.error || 0} error / ${jobs.cancelled || 0} cancelled`,
  `- AI usage: ${usage.calls} calls · ${fmtK(usage.tin)} tokens in / ${fmtK(usage.tout)} out · ${fmtK(usage.chars)} TTS chars · est. $${usage.cost.toFixed(2)}`,
  `- Published: ${publishes || '—'} · Calendar-driven runs: ${calendarRuns || '—'}`,
  '',
];
const entry = lines.join('\n');

// ---- write (idempotent: replace today's section if present) ------------------------
const HEADER = `# Production Journal

Daily operational log of AI Video Studio, written automatically by \`scripts/journal.mjs\`
from the studio's own database — every number is real production data.

`;
let md = existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8') : HEADER;
const secRe = new RegExp(`## ${dateStr}\\n(?:[^#]|#(?!#))*`, '');
md = secRe.test(md) ? md.replace(secRe, entry) : md + entry;

console.log(entry);
if (DRY) { console.log('[journal] dry-run — nothing written'); process.exit(0); }
writeFileSync(JOURNAL, md);

// ---- commit + push (only JOURNAL.md; safe on a dirty tree) -------------------------
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { stdio: 'pipe' }).toString().trim();
try {
  git('add', 'JOURNAL.md');
  const staged = git('diff', '--cached', '--name-only');
  if (!staged.includes('JOURNAL.md')) { console.log('[journal] no change today — nothing to commit'); process.exit(0); }
  git('-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`,
    'commit', '-m', `journal: ${dateStr} production log`, '--only', 'JOURNAL.md');
  git('pull', '--rebase', '--autostash', 'origin', 'main');
  git('push', 'origin', 'main');
  console.log(`[journal] committed & pushed ${dateStr}`);
} catch (e) {
  console.error('[journal] git step failed:', e.stderr?.toString() || e.message);
  process.exit(1);
}
process.exit(0);
