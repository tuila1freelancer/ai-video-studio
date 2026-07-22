// Versioned schema migrations, driven by PRAGMA user_version.
//
// Division of labor with connection.js:
//   - NEW tables keep being born via CREATE TABLE IF NOT EXISTS in connection.js — the
//     proven idempotent pattern (channels/styles/library all shipped that way).
//   - Every column ALTER + backfill lives HERE, as a numbered migration. Append-only:
//     never edit or reorder a shipped migration — add a new one.
//
// Each migration runs inside one transaction and user_version advances with it, so a
// mid-migration crash rolls back cleanly. Before applying anything pending, the DB file
// is checkpointed and copied to data/backups/ (latest 10 kept).
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from '../config/paths.js';

const KEEP_BACKUPS = 10;

// Ordered, append-only registry. id must be a positive integer, strictly increasing.
const MIGRATIONS = [
  {
    id: 1,
    name: 'baseline-pre-migrator-alters',
    // The three column ALTERs that predate user_version tracking. Idempotent by
    // construction (checks PRAGMA table_info) so DBs of every vintage converge.
    up(db) {
      const scols = db.prepare('PRAGMA table_info(scenes)').all().map((c) => c.name);
      if (!scols.includes('template')) db.exec('ALTER TABLE scenes ADD COLUMN template TEXT');
      if (!scols.includes('props')) db.exec('ALTER TABLE scenes ADD COLUMN props TEXT');
      const pcols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
      if (!pcols.includes('channel_id')) db.exec('ALTER TABLE projects ADD COLUMN channel_id TEXT');
    },
  },
  {
    id: 2,
    name: 'scene-input-fingerprints',
    // fp = JSON {tts, img, render}: content hashes of each artifact's inputs, so resume can
    // tell "artifact exists" from "artifact is still CURRENT". NULL (legacy rows) means
    // "trust the artifact" — exactly the old existence-based behavior.
    up(db) {
      const scols = db.prepare('PRAGMA table_info(scenes)').all().map((c) => c.name);
      if (!scols.includes('fp')) db.exec('ALTER TABLE scenes ADD COLUMN fp TEXT');
    },
  },
  {
    id: 3,
    name: 'scene-gate-approval',
    // Scene gate (visuals-first pipeline): timestamp of the owner's explicit "scenes look
    // good — go voice + render" approval. NULL = not approved; a project with
    // config.sceneGate holds at status 'scenes' after B5 until this is set. Durable so a
    // crash/auto-resume AFTER approval never re-holds, and one BEFORE approval always
    // re-holds (the gate can never auto-spend TTS credits).
    up(db) {
      const pcols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
      if (!pcols.includes('scenes_approved_at')) db.exec('ALTER TABLE projects ADD COLUMN scenes_approved_at INTEGER');
    },
  },
  {
    id: 4,
    name: 'scene-assets',
    // Per-scene project-asset assignment (reference-app image-full parity): the master
    // engine assigns uploaded assets to the 1–2 scenes each fits; the names persist here
    // (JSON array) so codegen/image-full can resolve them against config.assets.
    up(db) {
      const scols = db.prepare('PRAGMA table_info(scenes)').all().map((c) => c.name);
      if (!scols.includes('assets')) db.exec('ALTER TABLE scenes ADD COLUMN assets TEXT');
    },
  },
  {
    id: 5,
    name: 'single-visual-mode',
    // P36: the animation + image visual modes were removed — HyperFrame is the only mode. Any
    // stored config that still names 'animation' or 'image' is coerced to 'hyperframe' so the
    // UI labels/chips and any resume read a truthful mode. An ABSENT visualMode already
    // resolves to 'hyperframe' via the runtime default, so it is left untouched. No scene
    // artifacts are changed: a rendered clip keeps playing; an unrendered legacy scene
    // re-enters HyperFrame codegen on its next run, and a scene whose stored template no
    // longer exists still renders via the kinetic-statement fallback.
    up(db) {
      const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
      for (const table of ['projects', 'channels', 'channel_presets', 'calendar_slots', 'calendar_recurrences']) {
        if (!hasTable.get(table)) continue;
        const rows = db.prepare(`SELECT id, config FROM ${table}`).all();
        const upd = db.prepare(`UPDATE ${table} SET config = ? WHERE id = ?`);
        for (const row of rows) {
          if (!row.config) continue;
          let cfg;
          try { cfg = JSON.parse(row.config); } catch { continue; }
          if (cfg && typeof cfg === 'object' && (cfg.visualMode === 'animation' || cfg.visualMode === 'image')) {
            cfg.visualMode = 'hyperframe';
            upd.run(JSON.stringify(cfg), row.id);
          }
        }
      }
    },
  },
];

function backupBefore(db) {
  try {
    const dir = join(DIRS.data, 'backups');
    mkdirSync(dir, { recursive: true });
    db.pragma('wal_checkpoint(TRUNCATE)'); // fold the WAL in so the copy is self-contained
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    copyFileSync(join(DIRS.data, 'studio.sqlite'), join(dir, `studio-${stamp}.sqlite`));
    const old = readdirSync(dir).filter((f) => /^studio-.*\.sqlite$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) rmSync(join(dir, f), { force: true });
  } catch { /* a failed backup must not block boot — migrations are transactional regardless */ }
}

/**
 * Apply all pending migrations. Called once from connection.js after the CREATE TABLE
 * blocks and before db/index.js's bootstrap runs any query.
 * @returns {{applied: number, version: number}}
 */
export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  const pending = MIGRATIONS.filter((m) => m.id > current).sort((a, b) => a.id - b.id);
  if (!pending.length) return { applied: 0, version: current };
  backupBefore(db);
  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.id}`);
    })();
  }
  return { applied: pending.length, version: pending[pending.length - 1].id };
}
