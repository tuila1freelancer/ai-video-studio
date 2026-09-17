// Every thumbnail a project has ever had.
//
// The design used to live in `metadata.thumbnail.html` as ONE value: regenerating overwrote it,
// so a worse design could not be undone and a good one could not be compared against its
// replacement. A thumbnail is the single highest-leverage image a video has — it deserves the
// same "I could go back" guarantee the export history gives the video itself.
import { stmt } from '../connection.js';
import { newId } from '../../util/util.js';

export function addThumbnail({ projectId, path = null, html = null, source = 'ai', instruction = null, composition = null }) {
  const id = newId('th');
  stmt(`INSERT INTO thumbnails (id, project_id, path, html, source, instruction, composition, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, projectId, path, html, source, instruction, composition, Date.now());
  return getThumbnail(id);
}

export function listThumbnails(projectId, limit = 30) {
  return stmt('SELECT * FROM thumbnails WHERE project_id=? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit);
}

export function getThumbnail(id) {
  return stmt('SELECT * FROM thumbnails WHERE id=?').get(id) || null;
}

export function deleteThumbnail(id) {
  return stmt('DELETE FROM thumbnails WHERE id=?').run(id).changes > 0;
}
