// Brand Asset generation (P27) — reference-app parity lane.
// The two prompts are VERBATIM copies of the reference app's brand-gen prompts with exactly
// ONE owner-mandated edit: the image prompt's background sentence is hardened from
// "Transparent or clean solid background." to a mandatory true-alpha transparent background.
// Contract: the image model selected in settings gets up to 10 attempts (a non-transparent
// result consumes an attempt), then the item FAILS LOUDLY naming provider+model — no
// provider/model fallback, no placeholder images.
import { mkdirSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as DB from '../../db/index.js';
import { DIRS } from '../../config/paths.js';
import { chatJson } from '../../providers/llm.js';
import { editImage } from '../../providers/imagegen.js';
import { presetById } from '../../providers/llm-presets.js';
import { verifyTransparentBg } from '../../media/ffmpeg.js';
import { logger } from '../../util/log.js';

export const BRAND_EDIT_ATTEMPTS = 10;

// Appended (as a new sentence) when a returned image fails the transparency gate — the
// re-ask stays inside the same 10-attempt budget.
export const TRANSPARENT_RETRY_LINE =
  'The previous image had a non-transparent background — regenerate with a TRUE alpha-channel transparent background.';

/** Reference emotion-list prompt, verbatim. count clamps 1..50 (default 20). */
export function buildEmotionsPrompt({ characterName, count, context } = {}) {
  const n = Math.max(1, Math.min(50, Number(count) || 20));
  const ctx = String(context || '').trim();
  const domain = ctx || 'general content';
  const contextBlock = ctx ? `
IMPORTANT — The character's domain/context is: "${ctx}"
ALL emotions and actions MUST be relevant to this specific context. Do NOT generate finance/crypto/trading related content unless the context explicitly mentions it.
` : '';
  const prompt = `You are a character emotion/action designer for brand assets.

Given a character named "${characterName}", generate exactly ${n} unique emotions and actions.
${contextBlock}
The character's theme/domain: ${domain}

Rules:
- Each item is a short English phrase (3-8 words) describing an emotion or physical action
- ALL items must be relevant to the domain: "${domain}" — do NOT default to crypto/finance/trading
- Mix between pure emotions (crying, showing anger, laughing) and contextual actions specific to "${domain}"
- Include common reactions: happy, sad, angry, surprised, thinking, explaining
- Include domain-specific actions that match "${domain}"
- Format: lowercase, descriptive
- Must be diverse — no duplicates or near-duplicates
- Do NOT include the character name in the items

Return JSON: { "emotions": ["emotion or action 1", "emotion or action 2", ...] }`;
  return { prompt, count: n };
}

/** Reference image prompt with the single mandated transparency edit. */
export function buildCharacterPrompt({ characterName, emotion, style } = {}) {
  const st = String(style || '2D Anime style').trim() || '2D Anime style';
  return `Generate a character illustration in ${st}: "${String(characterName).trim()}" ${String(emotion).trim()}. `
    + `Same character design as the reference image. Art style: ${st}. `
    + `Background MUST be fully transparent (true alpha PNG) — the image contains ONLY the character; no backdrop, no floor, no frame, no solid color behind the character. `
    + `Full body or upper body visible. Expressive pose matching the emotion/action. PNG style, suitable for video overlay.`;
}

/** Resolve the Brand Asset page's provider/model pick from settings → throws when unset. */
export function brandEditConfig(settings = DB.aiSettings()) {
  const ig = settings.imageGen || {};
  const providers = Array.isArray(ig.editProviders) ? ig.editProviders : [];
  const pick = ig.brandEdit || {};
  const provider = providers.find((p) => p.id === pick.providerId) || providers[0] || null;
  if (!provider || !provider.baseUrl || !provider.apiKey) {
    throw new Error('Chưa cấu hình provider tạo ảnh (images/edits) — thêm ở mục Provider & Model của trang Brand Asset.');
  }
  return {
    provider,
    model: String(pick.model || 'gpt-image-2').trim() || 'gpt-image-2',
    size: String(pick.size || '1024x1536').trim() || '1024x1536',
  };
}

// Reference filename scheme, kept spaces and all: `character <name> <emotion>.png`.
const sanitizePart = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\.\./g, '').replace(/\s+/g, ' ').trim();
export function assetFilename(characterName, emotion) {
  const nm = sanitizePart(characterName), em = sanitizePart(emotion);
  if (!nm || !em) throw new Error('Thiếu characterName hoặc emotion');
  return `character ${nm} ${em}.png`;
}
const brandDir = (brand) => {
  const b = sanitizePart(brand) || 'Default';
  const dir = join(DIRS.brand, b);
  mkdirSync(dir, { recursive: true });
  return { brand: b, dir };
};

/** Emotion/action list via the AI-Settings LLM. Returns {characterName, emotions}. */
export async function generateEmotions({ characterName, count, context } = {}, { llm, _chatJson } = {}) {
  const name = String(characterName || '').trim();
  if (!name) throw new Error('Thiếu tên nhân vật (characterName)');
  const { prompt, count: n } = buildEmotionsPrompt({ characterName: name, count, context });
  const call = _chatJson || chatJson;
  const out = await call([{ role: 'user', content: prompt }], {
    maxTokens: 1600, temperature: 0.8, llm: llm || DB.aiSettings().llm,
    validate: (x) => Array.isArray(x?.emotions) && x.emotions.length > 0,
  });
  return { characterName: name, emotions: out.emotions.map((e) => String(e).trim()).filter(Boolean).slice(0, n) };
}

/**
 * Generate ONE brand asset image from the reference photo (10 attempts, transparency-gated,
 * no fallback). Saves `character <name> <emotion>.png` into the brand folder and registers
 * a library row (kind 'brand') so the asset flows into the normal asset lanes (P18/P22).
 */
export async function generateBrandAsset({ imagePath, characterName, emotion, brand, style } = {},
  { settings, onLog, _editImage, _verify, _sleep } = {}) {
  if (!imagePath || !existsSync(imagePath)) throw new Error('Thiếu ảnh tham chiếu');
  const name = String(characterName || '').trim(), emo = String(emotion || '').trim();
  if (!name) throw new Error('Thiếu characterName');
  if (!emo) throw new Error('Thiếu emotion');
  const cfg = brandEditConfig(settings);
  const { brand: brandName, dir } = brandDir(brand);
  const filename = assetFilename(name, emo);
  const outPath = join(dir, filename);
  const basePrompt = buildCharacterPrompt({ characterName: name, emotion: emo, style });
  const edit = _editImage || editImage;
  const verify = _verify || verifyTransparentBg;
  const sleep = _sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  let lastErr = null, prompt = basePrompt;
  for (let attempt = 1; attempt <= BRAND_EDIT_ATTEMPTS; attempt++) {
    onLog?.(`↻ "${emo}" — lần ${attempt}/${BRAND_EDIT_ATTEMPTS} (${cfg.provider.label || cfg.provider.id} · ${cfg.model})`);
    try {
      const buf = await edit({
        imagePath, prompt, baseUrl: cfg.provider.baseUrl, apiKey: cfg.provider.apiKey,
        model: cfg.model, size: cfg.size,
      });
      if (!buf || buf.length < 1500) throw new Error('ảnh trả về rỗng/quá nhỏ');
      writeFileSync(outPath, buf);
      const tp = await verify(outPath);
      if (!tp.ok) { // consumes the attempt; harden the ask and go again
        lastErr = new Error(`nền chưa trong suốt: ${tp.reason}`);
        prompt = `${basePrompt} ${TRANSPARENT_RETRY_LINE}`;
        continue;
      }
      const item = DB.addLibrary({ kind: 'brand', brandFolder: brandName, name: filename, filename, path: outPath, size: buf.length });
      return { ok: true, filename, path: outPath, size: buf.length, brand: brandName, item };
    } catch (e) {
      lastErr = e;
      logger.warn(`brand-gen "${emo}" attempt ${attempt}/${BRAND_EDIT_ATTEMPTS}: ${e.message}`);
      if (/HTTP (429|5\d\d)/.test(e.message) && attempt < BRAND_EDIT_ATTEMPTS) {
        await sleep(Math.min(10000, 1200 * attempt));
      }
    }
  }
  throw new Error(`Brand asset "${emo}" thất bại sau ${BRAND_EDIT_ATTEMPTS} lần thử với model chính `
    + `(${cfg.provider.label || cfg.provider.id} · ${cfg.model}) — không dùng fallback. Lỗi cuối: ${lastErr?.message || '?'}`);
}

/** Copy generated asset files between brand folders (reference copy-to-brand semantics). */
export function copyToBrand({ sourceBrand, targetBrand, filenames } = {}) {
  if (!sourceBrand || !targetBrand) throw new Error('Thiếu sourceBrand hoặc targetBrand');
  if (!Array.isArray(filenames) || !filenames.length) throw new Error('Thiếu filenames');
  const src = brandDir(sourceBrand), dst = brandDir(targetBrand);
  let copied = 0, skipped = 0;
  for (const f of filenames) {
    const fn = sanitizePart(basename(String(f)));
    const from = join(src.dir, fn), to = join(dst.dir, fn);
    if (!fn || !existsSync(from)) { skipped++; continue; }
    copyFileSync(from, to);
    DB.addLibrary({ kind: 'brand', brandFolder: dst.brand, name: fn, filename: fn, path: to, size: statSync(to).size });
    copied++;
  }
  return { ok: true, copied, skipped };
}

/** Create an (empty) brand folder so it appears in every brand picker. */
export function createBrand(nameRaw) {
  const name = sanitizePart(nameRaw);
  if (!name) throw new Error('Tên brand không hợp lệ');
  brandDir(name);
  return { ok: true, name };
}

// ---- image-edit provider management (server-side on purpose) ----
// PUT /settings replaces ARRAYS wholesale, so a client echoing masked '••' keys inside
// editProviders would clobber the real ones. Providers are therefore mutated HERE, where
// the unmasked settings live; the client only ever sends the one new real key.
export function addEditProvider({ presetId, label, baseUrl, apiKey } = {}) {
  // A preset (providers/llm-presets.js) carries the label and the endpoint, so the panel only
  // has to ask for a key — nobody knows offhand where a vendor's images/edits lives, and a
  // wrong URL surfaces only as a failed generation. Resolved HERE, not in the browser, so the
  // catalogue stays one source of truth.
  const preset = presetId && presetId !== 'custom' ? presetById(presetId) : null;
  if (presetId && presetId !== 'custom' && !preset?.lanes?.image) throw new Error('Nhà cung cấp này không sửa được ảnh');
  const l = String(preset?.label || label || '').trim();
  const u = String(preset?.baseUrl || baseUrl || '').trim().replace(/\/$/, '');
  if (!l || !/^https?:\/\//.test(u)) throw new Error('Cần tên hiển thị và Base URL hợp lệ (https://…)');
  if (!String(apiKey || '').trim()) throw new Error('Thiếu API key');
  const ai = DB.aiSettings();
  const ig = { ...(ai.imageGen || {}) };
  const providers = Array.isArray(ig.editProviders) ? [...ig.editProviders] : [];
  const id = `iep_${Date.now().toString(36)}`;
  providers.push({ id, label: l, baseUrl: u, apiKey: String(apiKey).trim() });
  ig.editProviders = providers;
  ig.brandEdit = { ...(ig.brandEdit || {}), providerId: id };
  DB.setSetting('ai', { ...ai, imageGen: ig });
  return { ok: true, id, label: l };
}

export function removeEditProvider(id) {
  const ai = DB.aiSettings();
  const ig = { ...(ai.imageGen || {}) };
  const providers = (Array.isArray(ig.editProviders) ? ig.editProviders : []).filter((p) => p.id !== id);
  ig.editProviders = providers;
  if (ig.brandEdit?.providerId === id) ig.brandEdit = { ...ig.brandEdit, providerId: providers[0]?.id || '' };
  DB.setSetting('ai', { ...ai, imageGen: ig });
  return { ok: true };
}
