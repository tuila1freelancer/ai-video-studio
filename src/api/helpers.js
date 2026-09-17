// Small things several routers share. Each was a closure of the old single mountRoutes().
import multer from 'multer';
import { DIRS } from '../config/paths.js';
import * as DB from '../db/index.js';
import { maskSecrets } from '../core/config.js';
import { t } from '../i18n/t.js';

export const upload = multer({ dest: DIRS.uploads, limits: { fileSize: 512 * 1024 * 1024 } });

/**
 * Translate the human words in a CATALOGUE payload — a provider's config form, an LLM preset's
 * note, a platform's field labels.
 *
 * Explicitly per route, never blanket: `name` on a voice, a channel or a project is DATA, and
 * translating it would rename the owner's own things. These three endpoints describe the app to
 * itself, so every string in them is interface text.
 */
const CATALOGUE_FIELDS = new Set(['label', 'name', 'note', 'hint', 'placeholder']);
export const localize = (v) => {
  if (Array.isArray(v)) return v.map(localize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = typeof val === 'string' && CATALOGUE_FIELDS.has(k) ? t(`srv.${val}`, null) : localize(val);
    }
    return out;
  }
  return v;
};

// Secrets (per-channel AI keys) are masked on every egress and a '••' round-trip
// on ingest keeps the saved value — same contract as /settings.
export const maskChannel = (ch) => ch && { ...ch, config: maskSecrets(ch.config || {}) };

// A thumbnail is codegen, not chat: it renders through headless Chrome from model-written
// markup, so it takes the codegen model like scene visuals do — never the general chat model.
export const thumbLlmFor = (proj) => {
  const base = DB.aiSettings().llm;
  if (!base) return base;
  return { ...base, model: proj?.config?.thumbnailModel || proj?.config?.hyperframe?.model || base.codegenModel || base.model };
};
export const fileUrlOf = (fp) => `/api/file?path=${encodeURIComponent(fp)}`;
