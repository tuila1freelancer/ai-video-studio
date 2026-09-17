// Deleting one project — files and all.
//
// The list could only ever delete EVERYTHING ("Xoá tất cả"), so getting rid of one failed
// experiment meant losing every finished video with it. The per-project route existed
// (`DELETE /projects/:id`) and nothing in the UI called it — and it only dropped the database
// row, leaving gigabytes of 4K clips behind for a button labelled "xoá".
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';

const routes = sourceOf('src/api/routes.js');
const studio = sourceOf('public/js/views/studio.js');

test('a project owns its working directory, and NOTHING it merely shares', () => {
  // THE dangerous case. `outputDir` is a CHANNEL folder: every video of "Tui Là 1 Freelancer"
  // publishes into the same one, so removing it to delete a single project would take every other
  // finished video with it. The deliverables there are removed one by one, by name; only the
  // per-project working directory goes whole.
  assert.match(routes, /function projectOwnedFiles\(p, scenes\) \{/);
  assert.match(routes, /const dir = DB\.projectDirFor\(p\.id\);/);
  assert.match(routes, /rmSync\(DB\.projectDirFor\(p\.id\), \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(routes, /rmSync\(.*outputDir/, 'the shared output folder must never be removed');
  // …and the named deliverables outside it are collected individually
  assert.match(routes, /for \(const f of \[p\.video_path, p\.thumb_path, \.\.\.\(p\.metadata\?\.covers \|\| \[\]\)\.map\(\(c\) => c\?\.path\)\]\)/);
  assert.match(routes, /!f\.startsWith\(dir\)/, 'a file already inside the working dir is not listed twice');
});

test('the confirmation names what disappears, measured rather than guessed', () => {
  // Deleting takes the files (owner's call, 2026-08-12), so a dialog saying "xoá dự án?" while
  // quietly removing 4 GB is not a confirmation. The footprint is asked for BEFORE the dialog and
  // reports the real file count and the real bytes.
  assert.match(routes, /r\.get\('\/projects\/:id\/footprint'/);
  assert.match(routes, /bytes \+= statSync\(f\)\.size/);
  assert.match(studio, /await api\.get\(`\/projects\/\$\{p\.id\}\/footprint`\)/);
  assert.match(studio, /SẼ XOÁ VĨNH VIỄN \$\{fp\.files\} file \(\$\{fmtBytes\(fp\.bytes\)\}\) khỏi ổ đĩa/);
  assert.match(studio, /Không khôi phục được/);
  assert.match(studio, /danger: true/);
  // a multi-line body only reads as lines if the dialog renders them as lines
  assert.match(sourceOf('public/css/app.css'), /\.dlg \.dlg-body\{[^}]*white-space:pre-line/);
});

test('a running project is refused, not deleted out from under its own pipeline', () => {
  assert.match(studio, /if \(\['running', 'queued'\]\.includes\(p\.status\)\) \{/);
  assert.match(studio, /bấm Dừng trước khi xoá/);
});

test('deleting the OPEN project clears the screen it was filling', () => {
  // Otherwise the panel keeps offering Render / Ghép / Xuất buttons that now act on nothing.
  assert.match(studio, /if \(state\.current\?\.id === p\.id\) startNewProject\(\);/);
  assert.match(studio, /it\.querySelector\('\.pitem-del'\)\.addEventListener/);
  assert.match(sourceOf('public/css/app.css'), /\.pitem-del:hover\{background:var\(--red/, 'a destructive control looks destructive');
});

test('"xoá tất cả" keeps the same promise as "xoá"', () => {
  // One of the two silently keeping files would be the worst of both worlds.
  assert.match(routes, /r\.delete\('\/projects', \(req, res\) => \{[\s\S]{0,400}purgeProjectFiles\(p\)/);
  assert.match(studio, /kèm TOÀN BỘ file trên ổ đĩa/);
});

test('a project\'s covers are named after it, so the next video cannot overwrite them', () => {
  // The channel's output folder is shared by every project; a fixed cover_shorts.jpg meant each
  // finished video replaced the previous video's covers while its metadata still pointed at them.
  assert.match(sourceOf('src/pipeline/finalize/thumbnail.js'), /baseName: `cover_\$\{projectId\}`/);
  assert.match(sourceOf('src/api/routers/project-outputs.js'), /baseName: `cover_\$\{p\.id\}`/);
});
