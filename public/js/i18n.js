// The interface language, in the browser.
//
// Catalogues are static JSON under public/locales/, fetched at boot. Deliberately NOT bundled:
// the build collapses 38 modules into one 232KB file with no code splitting, so inlining twelve
// catalogues would roughly quadruple it to ship eleven languages nobody is reading. Static files
// cost the build nothing — cpSync already copies every non-js path and express already serves it.
//
// The markup carries its Vietnamese as the DEFAULT. So a missed key, a failed fetch or a locale
// that does not exist all degrade to a Vietnamese interface rather than an empty one, and the
// app boots with no network at all.
let dict = {};
let fallback = {};
let current = 'vi';

/** The interface language in force. */
export function uiLang() { return current; }

/** Translate a key, filling `{name}` placeholders. Unknown keys return `def`, then the key. */
export function t(key, params = null, def = null) {
  const s = dict[key] ?? fallback[key] ?? def ?? key;
  if (!params) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined ? m : String(params[name])));
}

async function load(code) {
  try {
    const res = await fetch(`/locales/${code}.json`, { cache: 'no-cache' });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}

/**
 * Fetch the owner's catalogue and paint the markup with it.
 *
 * `vi` needs no catalogue at all — the markup already says it — so the Vietnamese interface pays
 * neither a fetch nor a DOM walk.
 */
export async function initI18n(code) {
  current = String(code || 'vi').toLowerCase();
  if (current === 'vi') return current;
  [dict, fallback] = await Promise.all([load(current), current === 'en' ? Promise.resolve({}) : load('en')]);
  applyDom();
  document.documentElement.lang = current;
  return current;
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];

/**
 * Paint one subtree. Called once at boot and again by anything that injects markup carrying keys.
 *
 * Text goes through textContent, never innerHTML: a translation is data from a JSON file, and the
 * one thing it must never be able to do is introduce markup.
 */
export function applyDom(root = document) {
  if (current === 'vi') return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const v = dict[el.dataset.i18n] ?? fallback[el.dataset.i18n];
    if (v != null) el.textContent = v;
  }
  for (const a of ATTRS) {
    const attr = `data-i18n-${a}`;
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const v = dict[el.getAttribute(attr)] ?? fallback[el.getAttribute(attr)];
      if (v != null) el.setAttribute(a, v);
    }
  }
}

/**
 * Change the interface language: persist it, then reload.
 *
 * A live swap would have to re-run three page hooks, two boot-time label patches and every open
 * modal's renderer, none of which is idempotent, for an action taken about once. The app already
 * restores its own session on reload — the running project reopens and the event hub replays its
 * buffer — so a reload is the cheap, honest answer.
 */
export async function setUiLanguage(code, api) {
  await api.put('/settings', { uiLang: code });
  try { localStorage.uiLang = code; } catch { /* private window */ }
  location.reload();
}

/**
 * Put an icon in front of a button WITHOUT losing its translation.
 *
 * The boot-time label writes did `el.innerHTML = icon + 'Tạo video tự động'`, which ran after the
 * catalogue had been painted and put the Vietnamese straight back — the most visible button in the
 * app stayed Vietnamese in an otherwise English interface. The label comes from the element's own
 * data-i18n key now, so the icon is the only thing this adds.
 */
export function setLabel(el, iconHtml, fallback = null) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  if (!node) return;
  const key = node.dataset.i18n;
  const text = key ? t(key, null, fallback ?? node.textContent.trim()) : (fallback ?? node.textContent.trim());
  node.innerHTML = `${iconHtml} ${text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}`;
}
