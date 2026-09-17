// Filesystem helpers the routers share.
import { copyFileSync, renameSync, unlinkSync } from 'node:fs';

/**
 * Move a file, across volumes if it has to. rename() fails with EXDEV when the destination sits
 * on another disk — a channel rooted under ~/Movies while uploads land on the app's own volume —
 * and every upload route used to answer that with an HTML 500.
 */
export function moveFile(from, to) {
  try { renameSync(from, to); } catch (e) {
    if (e?.code !== 'EXDEV') throw e;
    copyFileSync(from, to);
    unlinkSync(from);
  }
  return to;
}
