// Brand-asset auto-casting (P40) — reference-app parity for "put the brand's own art in the video".
//
// The reference app keeps a per-brand folder of mascot cutouts (`character <name> <emotion>.png`)
// and concept backgrounds, asks its model for per-scene keywords, then filename-matches those
// keywords against the folder. We do the equivalent in ONE call but hand the model the REAL
// catalog instead of keywords — the same shape as our sound-design lane (audio/sound-design.js),
// so a pick is always an existing file and never a hallucinated filename that silently drops.
//
// Everything downstream is unchanged: picks are merged into the existing image-full asset lane,
// so a cast asset becomes a {{asset:NAME}} placeholder the codegen model may place. The lane is
// additive and failure-tolerant — no LLM, empty library, or unparseable reply simply means the
// video is designed media-free, exactly as before this feature.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { DIRS } from '../config/paths.js';
import { chat, llmEnabled } from '../providers/llm.js';
import { safeJson } from '../util/util.js';

import { tp } from '../i18n/t.js';
/** A mascot cutout follows the reference naming scheme; everything else is concept art. */
export function isCharacterAsset(name) {
  return /^character\b/i.test(String(name || '').trim());
}

const ART = /\.(png|jpe?g|webp|gif|svg)$/i;

/**
 * The brand folder's usable art. Returns [{ name, path, character }] — `name` is what the codegen
 * placeholder is keyed by, so it must stay exactly as stored.
 *
 * The DB rows are the assets uploaded or generated through the app; the FOLDER is what the user
 * sees in Finder. Reading only the DB (as this did at first) made art dropped straight into the
 * folder invisible — the reference app reads the folder, and dropping files in is the obvious
 * thing to do. Both are unioned, DB rows winning on a name clash since they carry the real row.
 */
export function brandCatalog(brandFolder = 'Default') {
  const seen = new Map();
  for (const r of DB.listLibrary('brand', brandFolder) || []) {
    if (r?.path && r?.name && ART.test(r.name) && existsSync(r.path)) {
      seen.set(r.name.toLowerCase(), { name: r.name, path: r.path, character: isCharacterAsset(r.name) });
    }
  }
  try {
    const dir = join(DIRS.brand, brandFolder);
    for (const f of readdirSync(dir)) {
      if (!ART.test(f) || f.startsWith('.') || seen.has(f.toLowerCase())) continue;
      seen.set(f.toLowerCase(), { name: f, path: join(dir, f), character: isCharacterAsset(f) });
    }
  } catch { /* no such folder — the DB rows (or nothing) are the catalog */ }
  return [...seen.values()];
}

/** Brand folders the user actually has: registered in the DB or simply present on disk. */
export function brandFolders() {
  const out = new Set(DB.brandFolders() || []);
  try { for (const d of readdirSync(DIRS.brand, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('.')) out.add(d.name); }
  catch { /* library not created yet */ }
  out.add('Default');
  return [...out].sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b)));
}

/**
 * Which brand folder a project casts from. 'auto' (the default) uses the project's folder, or
 * 'Default' — matching the reference app, which always has a brand in play. `false`/'none' opts out.
 */
export function brandFolderFor(config = {}) {
  const v = config.brandAssets;
  if (v === false || v === 'none' || v === 'off') return null;
  if (typeof v === 'string' && v && v !== 'auto') return v;
  return config.brandFolder || 'Default';
}

/**
 * Project assets arrive in three shapes and only one of them used to survive: the UI pushes a
 * bare filesystem path (upload) or an `/api/file?path=…` URL (image search), while the master
 * script's asset list carries `{name, path}` objects. Filtering on `a.name && a.path` silently
 * dropped BOTH string shapes, so an asset the user uploaded never reached a scene. Normalize
 * every shape into `{name, path}`, keyed by a name a model can actually write.
 */
export function normalizeAssets(list = []) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a) continue;
    let path = null, name = null, character;
    if (typeof a === 'string') {
      const s = a.trim();
      if (!s) continue;
      // `/api/file?path=<encoded>` is how the UI refers to a local file it already has
      const m = /[?&]path=([^&]+)/.exec(s);
      path = m ? decodeURIComponent(m[1]) : (s.startsWith('/') ? s : null);
      if (!path) continue; // a remote http URL must be downloaded first (POST /media/download)
    } else if (a.path) {
      path = String(a.path);
      name = a.name ? String(a.name) : null;
      character = a.character;
    } else continue;
    const base = path.split('/').pop() || path;
    out.push({ name: name || base, path, ...(character === undefined ? {} : { character }) });
  }
  return out;
}

/**
 * ONE resolver for the image-full lane, shared by the batch (stages/visuals.js) and single-scene
 * (regen.js) paths so a regenerated scene keeps exactly the media the batch gave it. Names are
 * looked up across project uploads AND the brand folder; a project upload of the same name wins.
 * A scene may name an asset by its stored name OR by its bare filename — the master script sees
 * one and the user's UI list may carry the other.
 * @returns {(scene) => ({name, uri, character}[]|null)}
 */
export function sceneMediaResolver(config = {}, { heroMediaUri }) {
  if (config.hyperframe?.imageFull === false) return () => null;
  const byName = new Map();
  for (const a of normalizeAssets(config.assets)) {
    byName.set(a.name.toLowerCase(), a);
    const base = (a.path.split('/').pop() || '').toLowerCase();
    if (base && !byName.has(base)) byName.set(base, a); // also findable by bare filename
  }
  const folder = brandFolderFor(config);
  for (const a of folder ? brandCatalog(folder) : []) {
    const k = a.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, a);
  }
  return (scene) => {
    if (!byName.size || !Array.isArray(scene?.assets) || !scene.assets.length) return null;
    const out = [];
    for (const name of scene.assets) {
      const a = byName.get(String(name || '').toLowerCase());
      if (!a) continue;
      // A mascot cutout must keep its alpha (a JPEG pastes a black rectangle) and never needs
      // hero resolution — it stands beside the type, not under it.
      const uri = a.character ? heroMediaUri(a.path, { maxW: 720, alpha: true }) : heroMediaUri(a.path);
      if (uri) out.push({ name: a.name, uri, character: !!a.character });
    }
    return out.length ? out : null;
  };
}

const SYS = 'You are a video art director casting a brand\'s own artwork into the scenes of one video. '
  + 'You pick from a FIXED library — never invent a filename. Reply with ONLY a JSON object.';

/** Keep the model's reply honest: real filenames, at most `max` per scene, no duplicates. */
export function sanitizeCast(raw, catalog = [], { max = 2 } = {}) {
  const out = new Map();
  if (!raw || typeof raw !== 'object' || !catalog.length) return out;
  const byLower = new Map(catalog.map((a) => [a.name.toLowerCase(), a.name]));
  for (const [key, val] of Object.entries(raw)) {
    const stt = Number.parseInt(key, 10);
    if (!Number.isFinite(stt)) continue;
    const names = [];
    for (const item of Array.isArray(val) ? val : [val]) {
      const want = String(item || '').trim().toLowerCase();
      if (!want) continue;
      // exact filename first, then a forgiving contains-match (models drop the extension)
      const hit = byLower.get(want)
        || catalog.find((a) => a.name.toLowerCase().startsWith(want))?.name
        || catalog.find((a) => a.name.toLowerCase().includes(want))?.name;
      if (hit && !names.includes(hit)) names.push(hit);
      if (names.length >= max) break;
    }
    if (names.length) out.set(stt, names);
  }
  return out;
}

/**
 * Cast brand art across a video's scenes.
 * @returns {Promise<Map<number, string[]>>} scene stt (1-based) → asset names, empty when unavailable.
 */
export async function castBrandAssets({ scenes = [], catalog = [], title = '', llm = null, onLog = () => {} } = {}) {
  if (!scenes.length || !catalog.length || !llmEnabled(llm)) return new Map();
  const chars = catalog.filter((a) => a.character);
  const props = catalog.filter((a) => !a.character);
  const listOf = (arr) => arr.map((a) => `- ${a.name}`).join('\n');
  const sceneList = scenes
    .map((s, i) => `${i + 1}. ${String(s.voice_text || '').trim().slice(0, 180)}`)
    .join('\n');
  const user = [
    `VIDEO: "${String(title || '').trim().slice(0, 160)}"`,
    chars.length ? `CHARACTER CUTOUTS (the brand mascot, one emotion/action each — pick the one whose emotion matches what the scene SAYS):\n${listOf(chars)}` : '',
    props.length ? `CONCEPT ART / BACKGROUNDS:\n${listOf(props)}` : '',
    `SCENES (number. narration):\n${sceneList}`,
    [
      'RULES:',
      '• Match by MEANING — the library is named in English, the narration may be Vietnamese (or vice versa).',
      '• At most 2 assets per scene, and use each asset in at most 2 scenes across the whole video.',
      '• A scene with no genuinely fitting asset gets NOTHING — leave it out. Half the scenes having no asset is a good result; forcing art onto every scene looks cheap.',
      '• Prefer the mascot on scenes with a human reaction (surprise, worry, joy, explaining) and concept art on scenes about a topic or place.',
      '• Copy filenames EXACTLY as listed, including the extension.',
      '',
      'Reply with ONLY a JSON object: scene number (string) → array of filenames. Example:',
      '{"1": ["character ema thinking.png"], "4": ["chart background.png", "character ema smiling.png"]}',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');

  try {
    const reply = await chat([
      { role: 'system', content: SYS },
      { role: 'user', content: user },
    ], { json: true, temperature: 0.4, maxTokens: 2000, llm });
    const cast = sanitizeCast(safeJson(reply, null), catalog);
    onLog(cast.size
      ? tp`brand assets: cast into ${cast.size}/${scenes.length} cảnh`
      : 'brand assets: model chose none — scenes stay media-free');
    return cast;
  } catch (e) {
    onLog(tp`brand assets: bỏ qua (${e.message})`);
    return new Map();
  }
}
