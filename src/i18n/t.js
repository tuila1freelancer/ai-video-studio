// The interface language, on the server side.
//
// This is a single-user desktop app: one person, one machine, one interface language. So there is
// no request-scoped locale and no Accept-Language negotiation — the server simply knows which
// language the owner set, the same way it knows which voice they picked.
//
// Catalogues are the SAME files the browser fetches (public/locales/<code>.json), so a string can
// never be translated on one side of the wire and not the other, and there is exactly one file to
// hand a translator per language.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config/paths.js';
import { DEFAULT_LANG, isSupported } from './languages.js';

const cache = new Map();
let current = DEFAULT_LANG;

function catalogue(code) {
  if (cache.has(code)) return cache.get(code);
  const file = join(PATHS.publicDir, 'locales', `${code}.json`);
  let data = {};
  try { if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* a broken catalogue must not stop a render */ }
  cache.set(code, data);
  return data;
}

/** Set the interface language. Called at boot and whenever the owner changes it. */
export function setUiLang(code) {
  current = isSupported(code) ? String(code).toLowerCase() : DEFAULT_LANG;
  return current;
}

/** The interface language in force. */
export function uiLang() { return current; }

/** Drop the parsed catalogues — used by tests and after a catalogue is rewritten. */
export function reloadCatalogues() { cache.clear(); }

/**
 * Translate a key, filling `{name}` placeholders.
 *
 * Falls back through the owner's language → English → the key itself. Returning the KEY rather
 * than an empty string is deliberate: a missing translation should look obviously wrong in the
 * interface, not silently blank a button.
 */
export function t(key, params = null) {
  const k = String(key || '');
  // A `srv.<Vietnamese sentence>` key IS its own Vietnamese fallback (the gettext model), so an
  // untranslated one must show the sentence, never the literal "srv.…".
  const self = k.startsWith('srv.') ? k.slice(4) : k;
  const s = catalogue(current)[k] ?? catalogue('en')[k] ?? self;
  if (!params) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined ? m : String(params[name])));
}
