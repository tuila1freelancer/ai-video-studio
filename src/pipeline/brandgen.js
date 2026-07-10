// Brand-asset generation (offline fallback: tinted variation posters from the reference).
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { DIRS } from '../config/paths.js';
import { buildSceneBackground } from './visuals.js';

export async function brandGenImpl(body, file) {
  const name = (body.charName || 'character').replace(/[^\w]/g, '') || 'character';
  const styleText = body.style || '2D Anime style';
  const emotions = ['happy', 'sad', 'angry', 'surprised', 'thinking', 'confident'];
  const brand = body.brand || name;
  const dir = join(DIRS.brand, brand);
  mkdirSync(dir, { recursive: true });
  const items = [];
  for (let i = 0; i < emotions.length; i++) {
    const out = join(dir, `${name}_${emotions[i]}_${Date.now()}.png`);
    const sc = { idx: i, keywords: [emotions[i]], visual_prompt: `${name} — ${emotions[i]} (${styleText})` };
    const bg = await buildSceneBackground(sc, { title: name }, { w: 768, h: 768 }, { dir, mode: 'html' });
    if (existsSync(bg)) { copyFileSync(bg, out); }
    const lib = DB.addLibrary({ kind: 'brand', brandFolder: brand, name: `${name}_${emotions[i]}.png`, filename: `${name}_${emotions[i]}.png`, path: out, size: 0 });
    items.push(lib);
  }
  return { items, brand, note: 'Offline placeholder set. Cấu hình API tạo ảnh để có nhân vật thật.' };
}
