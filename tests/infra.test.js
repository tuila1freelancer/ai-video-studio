// Infra invariants: durable job ledger semantics, governor pools, error taxonomy,
// WCAG guide lock, migration engine idempotence.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('jobs: claim order, per-project and per-batch serialization, zombie requeue', async () => {
  const DB = await import('../src/db/index.js');
  const j1 = DB.enqueueJob({ kind: 'render', projectId: 'pA' });
  await new Promise((r) => setTimeout(r, 3));
  DB.enqueueJob({ kind: 'render', projectId: 'pA' });
  const j3 = DB.enqueueJob({ kind: 'render', projectId: 'pB', batchId: 'b1' });
  const j4 = DB.enqueueJob({ kind: 'render', projectId: 'pC', batchId: 'b1' });

  assert.equal(DB.activeJobFor('pA', 'render').id, j1.id, 'dedupe returns the job that runs first');
  assert.equal(DB.claimNextJob(['render']).id, j1.id, 'oldest first');
  assert.equal(DB.claimNextJob(['render']).id, j3.id, 'same-project queued job must wait');
  assert.equal(DB.claimNextJob(['render']), null, 'same-batch job must wait (one video at a time)');
  DB.settleJob(j3.id, 'done');
  assert.equal(DB.batchFinished('b1'), false);
  const c4 = DB.claimNextJob(['render']);
  assert.equal(c4.id, j4.id);
  DB.settleJob(c4.id, 'done');
  assert.equal(DB.batchFinished('b1'), true);

  const z = DB.requeueZombieJobs(); // j1 is still 'running' with attempts=1
  assert.equal(z.requeued, 1);
  const again = DB.claimNextJob(['render']);
  assert.equal(again.id, j1.id);
  assert.equal(again.attempts, 2, 'a requeued job is a continuation (executor resumes)');
  DB.settleJob(again.id, 'done');
});

test('governor: pool blocks over capacity, grants on release, double-release is a no-op', async () => {
  const { acquire, configurePool, poolStats } = await import('../src/pipeline/governor.js');
  configurePool('test-pool', 2);
  const r1 = await acquire('test-pool');
  const r2 = await acquire('test-pool');
  let third = false;
  const p3 = acquire('test-pool').then((rel) => { third = true; return rel; });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(third, false);
  r1();
  const rel3 = await p3;
  assert.equal(third, true);
  r1(); // double release
  assert.equal(poolStats()['test-pool'].used, 2);
  r2(); rel3();
});

test('errors: deterministic classes lose the auto-resume, unknown stays transient', async () => {
  const { classifyError } = await import('../src/core/errors.js');
  assert.equal(classifyError(new Error('LLM 429: too many requests')).cls, 'rate-limit');
  assert.equal(classifyError(new Error('LLM 401: invalid_api_key')).retryable, false);
  assert.equal(classifyError(new Error('spawn ffmpeg ENOENT')).cls, 'resource');
  assert.equal(classifyError(new Error('anything else weird')).cls, 'transient');
  assert.equal(classifyError(new Error('anything else weird')).retryable, true);
});

test('styleguide: WCAG lock repairs an illegible palette and leaves compliant presets alone', async () => {
  const { normalizeGuide, ensureContrast } = await import('../src/styleguide/guide.js');
  // pathological: dark grey ink on near-black bg
  const g = normalizeGuide({ palette: { bg: '#0A0A0A', ink: '#222222', muted: '#111111', accents: ['#1A1A2E', '#16213E', '#0F3460'] } });
  const lum = (hex) => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255); };
  assert.ok(lum(g.palette.ink) > lum('#222222'), 'ink must be nudged toward legibility');
  // compliant color is returned byte-identical
  assert.equal(ensureContrast('#EAF2FF', '#0A0E1A', 4.5), '#EAF2FF');
  // normalization is idempotent (a repaired guide re-normalizes to itself)
  const g2 = normalizeGuide(g);
  assert.deepEqual(g2.palette, g.palette);
});

test('migrator: second run is a no-op at the same version', async () => {
  const db = (await import('../src/db/connection.js')).default;
  const { migrate } = await import('../src/db/migrate.js');
  const v = db.pragma('user_version', { simple: true });
  assert.ok(v >= 2, 'both shipped migrations applied on the fresh test DB');
  const r = migrate(db);
  assert.equal(r.applied, 0, 'no pending migrations on a current DB');
});

test('sqlite: WAL runs at synchronous=NORMAL with a bounded journal and a real page cache', async () => {
  const db = (await import('../src/db/connection.js')).default;
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('synchronous', { simple: true }), 1, 'NORMAL — no fsync per journal line');
  assert.equal(db.pragma('journal_size_limit', { simple: true }), 67108864);
  assert.equal(db.pragma('cache_size', { simple: true }), -32000);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('sqlite: the queries the repositories issue have an index to use', async () => {
  const db = (await import('../src/db/connection.js')).default;
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name));
  for (const ix of ['idx_projects_channel', 'idx_projects_updated', 'idx_jobs_batch', 'idx_calendar_project', 'idx_library_kind_folder', 'idx_sugg_slot']) {
    assert.ok(names.has(ix), `${ix} exists`);
  }
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM projects WHERE channel_id=? ORDER BY updated_at DESC').all('x');
  assert.ok(plan.some((r) => /idx_projects_channel/.test(r.detail)), `channel listing uses the index: ${plan.map((r) => r.detail).join(' | ')}`);
});

test('sqlite: stmt() compiles a statement once per SQL string', async () => {
  const { stmt } = await import('../src/db/connection.js');
  const a = stmt('SELECT 1 AS one');
  assert.equal(stmt('SELECT 1 AS one'), a, 'same object for the same SQL');
  assert.equal(a.get().one, 1);
});
