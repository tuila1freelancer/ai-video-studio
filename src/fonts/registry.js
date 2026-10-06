// The one list of typefaces this app admits to having.
//
// Before this, three different answers to "which fonts exist?" were in circulation and none of
// them agreed. The subtitle picker offered ten hard-coded names in index.html — two of which
// (Arial, Impact) appeared in neither the vendored CSS nor the burn directory. The scene page
// inlined eight families into every single page whether it used them or not. The app's own UI
// loaded exactly two. So the user could choose Anton, watch the preview fall back to the system
// sans-serif, and have no way to tell whether the video would be any different.
//
// Everything now derives from this file: what the picker offers, what the preview loads, what
// gets embedded into a scene page, and what the burn is allowed to ask libass for.
//
// Three ways a family can be real:
//   vendored     — built into vendor/fonts/ by scripts/build-fonts.mjs, always available
//   system       — ships with macOS; fontconfig and Chrome both find it, costs nothing
//   downloadable — on Google Fonts, fetched on request (never mid-render, never unasked)
//
// CJK sits deliberately on `system`. A single Noto Sans SC face is 5–20 MB; vendoring the set
// would dwarf the entire repository, while macOS already carries PingFang, Hiragino and Apple SD
// Gothic Neo where both renderers can see them.
import { vendoredFaces, uploadedFaces, isDownloaded, isSystemFamily, normFamily, SYSTEM_FAMILIES, allFaces } from './files.js';
import { coversScript, scriptsOf } from './coverage.js';

/**
 * Script coverage, used to put the right families in front of the user for the video's
 * language rather than making them scroll past forty Latin faces to find a Thai one.
 */
export const SCRIPTS = ['latin', 'vietnamese', 'cyrillic', 'greek', 'cjk-sc', 'cjk-tc', 'japanese', 'korean', 'arabic', 'thai', 'devanagari', 'hebrew'];

const L = ['latin'];
const LV = ['latin', 'vietnamese'];
const LVC = ['latin', 'vietnamese', 'cyrillic'];

/** family → { weights, scripts, google?, system? } */
export const CATALOGUE = [
  // --- vendored: the set the renderer has always had ---
  { family: 'Be Vietnam Pro', weights: [500, 700, 800], scripts: LV, google: 'Be Vietnam Pro' },
  { family: 'Lexend', weights: [400, 700], scripts: LV, google: 'Lexend' },
  { family: 'Montserrat', weights: [800], scripts: LVC, google: 'Montserrat' },
  { family: 'Oswald', weights: [700], scripts: LVC, google: 'Oswald' },
  { family: 'Anton', weights: [400], scripts: LV, google: 'Anton' },
  { family: 'Nunito', weights: [900], scripts: LVC, google: 'Nunito' },
  // Latin only, and measured: Google Fonts serves no Vietnamese subset for it, so the file is
  // missing every tone-marked letter. `fontLibrary` re-checks this against the file regardless.
  { family: 'Archivo Black', weights: [400], scripts: L, google: 'Archivo Black' },
  { family: 'JetBrains Mono', weights: [500, 700], scripts: LVC, google: 'JetBrains Mono' },

  // --- downloadable: display + headline faces that carry a video ---
  { family: 'Bebas Neue', weights: [400], scripts: L, google: 'Bebas Neue' },
  { family: 'Inter', weights: [400, 700, 900], scripts: LVC, google: 'Inter' },
  { family: 'Roboto', weights: [400, 700, 900], scripts: [...LVC, 'greek'], google: 'Roboto' },
  { family: 'Poppins', weights: [400, 600, 800], scripts: [...LV, 'devanagari'], google: 'Poppins' },
  { family: 'Open Sans', weights: [400, 700, 800], scripts: [...LVC, 'greek', 'hebrew'], google: 'Open Sans' },
  { family: 'Raleway', weights: [400, 700, 900], scripts: LVC, google: 'Raleway' },
  { family: 'Playfair Display', weights: [400, 700, 900], scripts: LVC, google: 'Playfair Display' },
  { family: 'Merriweather', weights: [400, 700, 900], scripts: LVC, google: 'Merriweather' },
  { family: 'Space Grotesk', weights: [400, 700], scripts: LV, google: 'Space Grotesk' },
  { family: 'Josefin Sans', weights: [400, 700], scripts: LV, google: 'Josefin Sans' },
  { family: 'Quicksand', weights: [400, 700], scripts: LV, google: 'Quicksand' },
  { family: 'Rubik', weights: [400, 700, 900], scripts: [...LVC, 'hebrew'], google: 'Rubik' },
  { family: 'Manrope', weights: [400, 700, 800], scripts: LVC, google: 'Manrope' },
  { family: 'Outfit', weights: [400, 700, 900], scripts: LV, google: 'Outfit' },
  { family: 'Sora', weights: [400, 700], scripts: LV, google: 'Sora' },
  { family: 'Barlow Condensed', weights: [400, 700], scripts: LV, google: 'Barlow Condensed' },
  { family: 'Fira Sans', weights: [400, 700, 900], scripts: [...LVC, 'greek'], google: 'Fira Sans' },
  { family: 'DM Sans', weights: [400, 700, 900], scripts: LV, google: 'DM Sans' },
  { family: 'Plus Jakarta Sans', weights: [400, 700, 800], scripts: LV, google: 'Plus Jakarta Sans' },
  { family: 'Libre Baskerville', weights: [400, 700], scripts: L, google: 'Libre Baskerville' },
  { family: 'Kanit', weights: [400, 700, 900], scripts: [...LV, 'thai'], google: 'Kanit' },
  { family: 'Prompt', weights: [400, 700], scripts: [...LV, 'thai'], google: 'Prompt' },
  { family: 'Cairo', weights: [400, 700, 900], scripts: [...L, 'arabic'], google: 'Cairo' },
  { family: 'Tajawal', weights: [400, 700, 900], scripts: [...L, 'arabic'], google: 'Tajawal' },
  { family: 'Heebo', weights: [400, 700, 900], scripts: [...L, 'hebrew'], google: 'Heebo' },

  // --- system: the practical answer for scripts nobody can vendor ---
  { family: 'PingFang SC', weights: [400, 600], scripts: ['cjk-sc', 'latin'], system: true },
  { family: 'PingFang TC', weights: [400, 600], scripts: ['cjk-tc', 'latin'], system: true },
  { family: 'Hiragino Sans', weights: [400, 700], scripts: ['japanese', 'latin'], system: true },
  { family: 'Apple SD Gothic Neo', weights: [400, 700], scripts: ['korean', 'latin'], system: true },
  { family: 'Geeza Pro', weights: [400, 700], scripts: ['arabic'], system: true },
  { family: 'Thonburi', weights: [400, 700], scripts: ['thai'], system: true },
  { family: 'Kohinoor Devanagari', weights: [400, 700], scripts: ['devanagari'], system: true },
  { family: 'Helvetica Neue', weights: [400, 700], scripts: [...L, 'greek'], system: true },
  { family: 'Impact', weights: [400], scripts: L, system: true },
  { family: 'Menlo', weights: [400, 700], scripts: L, system: true },
];

const BY_KEY = new Map(CATALOGUE.map((e) => [normFamily(e.family), e]));

export function catalogueEntry(family) {
  return BY_KEY.get(normFamily(family)) || null;
}

/** Which script a language's on-screen text belongs to. */
export function scriptForLanguage(lang) {
  const code = String(lang || '').toLowerCase().slice(0, 2);
  return {
    vi: 'vietnamese', zh: 'cjk-sc', ja: 'japanese', ko: 'korean', ar: 'arabic', fa: 'arabic',
    ur: 'arabic', he: 'hebrew', th: 'thai', hi: 'devanagari', bn: 'devanagari',
    ru: 'cyrillic', uk: 'cyrillic', bg: 'cyrillic', sr: 'cyrillic', el: 'greek',
  }[code] || 'latin';
}

/**
 * Every family the user may pick, with an honest status attached.
 *
 * `ready` is the only thing that matters at the point of choosing: a downloadable family that
 * has not been fetched will render as a substitute in both the preview and the video, so the
 * picker has to say so rather than list it as though it were there.
 *
 * @returns {Array<{family:string, source:string, ready:boolean, scripts:string[], weights:number[]}>}
 */
/**
 * A declared script survives only if every file we might hand the renderer can draw it.
 *
 * `every`, not `some`: a family with three weights whose bold alone lacks the script would
 * otherwise pass here and substitute at the one weight the headline uses. Families with no file
 * on disk (downloadable, system) keep the hand-written list — there is nothing to read.
 */
function verifiedScripts(key, declared, faces) {
  const mine = faces.filter((f) => f.key === key);
  if (!mine.length) return declared;
  return declared.filter((s) => mine.every((f) => coversScript(f.path, s)));
}

export function fontLibrary() {
  const faces = allFaces();
  const vendored = new Set(vendoredFaces().map((f) => f.key));
  const uploads = uploadedFaces();
  const uploaded = new Map(uploads.map((f) => [f.key, f]));
  const out = [];
  const push = (family, entry, extra) => {
    const key = normFamily(family);
    out.push({
      family,
      scripts: entry ? verifiedScripts(key, entry.scripts || ['latin'], faces)
        : (faces.find((f) => f.key === key) ? scriptsOf(faces.find((f) => f.key === key).path) : ['latin']),
      weights: entry?.weights || [400],
      google: entry?.google || null,
      ...extra,
    });
  };

  for (const entry of CATALOGUE) {
    const key = normFamily(entry.family);
    if (uploaded.has(key)) { push(entry.family, entry, { source: 'uploaded', ready: true }); continue; }
    if (vendored.has(key)) { push(entry.family, entry, { source: 'vendored', ready: true }); continue; }
    if (isDownloaded(entry.family)) { push(entry.family, entry, { source: 'downloaded', ready: true }); continue; }
    if (entry.system || isSystemFamily(entry.family)) { push(entry.family, entry, { source: 'system', ready: true }); continue; }
    push(entry.family, entry, { source: 'downloadable', ready: false });
  }
  // the user's own uploads that are not in the catalogue at all
  for (const up of uploads) {
    if (BY_KEY.has(up.key)) continue;
    push(up.family, null, { source: 'uploaded', ready: true, burnable: up.burnable !== false });
  }
  return out;
}

/** Families that can be used right now, ordered with the video's own script first. */
export function familiesForLanguage(lang) {
  const want = scriptForLanguage(lang);
  const lib = fontLibrary();
  const score = (f) => (f.scripts.includes(want) ? 0 : 1) * 10 + (f.ready ? 0 : 1);
  return lib.slice().sort((a, b) => score(a) - score(b) || a.family.localeCompare(b.family));
}

/** Is this family safe to hand to the renderer without a substitution happening behind our back? */
export function familyReady(family) {
  const key = normFamily(family);
  if (!key) return false;
  if (uploadedFaces().some((f) => f.key === key)) return true;
  if (vendoredFaces().some((f) => f.key === key)) return true;
  if (isDownloaded(family)) return true;
  return isSystemFamily(family);
}

export { SYSTEM_FAMILIES };
