// What a project owns on disk, and how it is removed.
import { existsSync, statSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';

/**
 * Every file this project OWNS — and nothing it merely shares.
 *
 * The working directory is exclusive, so it goes whole. `outputDir` is NOT: several projects of
 * one channel publish into the same folder, so deleting it would take other people's finished
 * videos with it. The deliverables there are removed one by one, by name.
 */
export function projectOwnedFiles(p, scenes) {
  const out = [];
  const dir = DB.projectDirFor(p.id);
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full); else out.push(full);
    }
  };
  try { if (existsSync(dir)) walk(dir); } catch { /* unreadable — report what we have */ }
  for (const f of [p.video_path, p.thumb_path, ...(p.metadata?.covers || []).map((c) => c?.path)]) {
    if (f && existsSync(f) && !f.startsWith(dir)) out.push(f);
  }
  return [...new Set(out)];
}

/** Delete the owned files, then the working directory itself. Never a shared output folder. */
export function purgeProjectFiles(p) {
  const scenes = DB.getScenes(p.id);
  const files = projectOwnedFiles(p, scenes);
  let bytes = 0;
  let n = 0;
  for (const f of files) {
    try { bytes += statSync(f).size; unlinkSync(f); n++; } catch { /* gone or locked — keep going */ }
  }
  try { rmSync(DB.projectDirFor(p.id), { recursive: true, force: true }); } catch { /* best effort */ }
  return { files: n, bytes };
}
