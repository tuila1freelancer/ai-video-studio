// Persistence barrel — the single import surface for the rest of the app.
// `import * as DB from '../db/index.js'` gives every repository function plus the raw handle.
// Schema/migrations live in ./connection.js; queries live in ./repositories/*.
import db from './connection.js';
import { listStyles, createStyle } from './repositories/catalogs.js';
import { defaultChannel } from './repositories/channels.js';

export * from './repositories/settings.js';
export * from './repositories/projects.js';
export * from './repositories/scenes.js';
export * from './repositories/channels.js';
export * from './repositories/catalogs.js';
export * from './repositories/jobs.js';
export * from './repositories/usage.js';
export * from './repositories/reviews.js';
export * from './repositories/takes.js';
export * from './repositories/publishes.js';
export * from './repositories/calendar.js';

// ---- one-time bootstrap (runs on first import) ----
// existing projects belong to Default
{
  const def = defaultChannel();
  db.prepare('UPDATE projects SET channel_id=? WHERE channel_id IS NULL').run(def.id);
}

// seed default styles once
if (listStyles('scene').length === 0) {
  createStyle({ name: 'Cinematic', kind: 'scene', builtin: 1, prompt: 'Cinematic, dramatic lighting, gradient overlays, smooth Ken-Burns motion, bold modern typography.' });
  createStyle({ name: 'Minimal', kind: 'scene', builtin: 1, prompt: 'Clean minimal flat design, soft pastel background, simple centered text, gentle fades.' });
  createStyle({ name: 'Neon Tech', kind: 'scene', builtin: 1, prompt: 'Dark background, neon glow, futuristic grid, glitch accents, animated highlights.' });
}
if (listStyles('metadata').length === 0) {
  createStyle({ name: 'Viral Hook', kind: 'metadata', builtin: 1, prompt: 'Tạo tiêu đề giật tít, mô tả ngắn cuốn hút và 12 hashtag thịnh hành cho mạng xã hội.' });
}

export default db;
