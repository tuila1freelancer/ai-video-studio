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
  // Drop the parsed catalogues too. They are keyed by language so switching would not strictly
  // need it — but a catalogue rewritten while the server is running (which is what happens every
  // time build-locales is used against a live dev server) would otherwise be served stale.
  cache.clear();
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

/**
 * Translate a string by its own Vietnamese text (the gettext msgid model), for the interface text
 * the server builds itself — a stage name, a journal line, an error body.
 */
export function m(text) {
  const s = String(text ?? '');
  const k = `srv.${s}`;
  return catalogue(current)[k] ?? catalogue('en')[k] ?? s;
}

/**
 * The same, for a message assembled by interpolation: tag the template instead of wrapping it.
 *
 *   tp`Đã ghép ${n} cảnh`   →  msgid "Đã ghép {0} cảnh"
 *
 * The static parts are the key; the values are substituted after the lookup, so a translation may
 * reorder them for a language whose word order differs.
 */
export function tp(strings, ...vals) {
  const msgid = strings.reduce((a, s, i) => a + (i ? `{${i - 1}}` : '') + s, '');
  const k = `srv.${msgid}`;
  const out = catalogue(current)[k] ?? catalogue('en')[k] ?? msgid;
  return out.replace(/\{(\d+)\}/g, (hit, i) => (vals[i] === undefined ? hit : String(vals[i])));
}
