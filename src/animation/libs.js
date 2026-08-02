// Creative runtime libraries for scene pages (P40) — reference-app parity, made deterministic.
//
// The reference app lets its codegen model add up to 4 CDN <script> imports (three.js, p5.js,
// tsParticles, countUp, extra GSAP plugins) and rewrites them to a local cache before render.
// We vendor the same set (scripts/build-libs.mjs → vendor/libs) and inject ONLY the libraries a
// scene actually references, so a text-only scene stays as light as it was before this feature.
//
// Determinism contract — the upgrade over the reference:
//   the renderer scrubs a PAUSED timeline frame by frame, so a library that draws on its own
//   requestAnimationFrame clock would produce a different picture every run. Every library here
//   is therefore driven from `window.__onSeek(fn)`: the harness calls each registered hook with
//   the current scene time on every seek, so a THREE/p5/canvas layer is a pure function of t.
//   Libraries that cannot be scrubbed (tsParticles owns its own loop) are still vendored — an
//   import must never 404 — but are NOT advertised to the model.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_DIR } from '../config/paths.js';

/**
 * Registry. `probe` matches the way a scene would actually reach for the library, so detection
 * never fires on an unrelated word ("p5" inside a hex colour, "three" inside prose).
 * `advertise` gates whether the codegen prompt offers it.
 */
export const LIBS = [
  { id: 'three', file: 'three.min.js', global: 'THREE', advertise: true, probe: /\bTHREE\s*\./ },
  { id: 'p5', file: 'p5.min.js', global: 'p5', advertise: true, probe: /\bnew\s+p5\s*\(/ },
  // countUp drives its own rAF, so it is vendored (an import must never 404) but not offered —
  // FX.counterRoll already counts a number deterministically on the paused timeline.
  { id: 'countup', file: 'countUp.umd.js', global: 'countUp', advertise: false, probe: /\bcountUp\s*\.|\bnew\s+CountUp\s*\(/ },
  { id: 'tsparticles', file: 'tsparticles.slim.bundle.min.js', global: 'tsParticles', advertise: false, probe: /\btsParticles\s*\./ },
  { id: 'scrolltrigger', file: 'ScrollTrigger.min.js', global: 'ScrollTrigger', advertise: false, probe: /\bScrollTrigger\b/ },
  { id: 'cssrule', file: 'CSSRulePlugin.min.js', global: 'CSSRulePlugin', advertise: false, probe: /\bCSSRulePlugin\b/ },
];

const byId = new Map(LIBS.map((l) => [l.id, l]));
const srcCache = new Map();

function libPath(lib) { return join(VENDOR_DIR, 'libs', lib.file); }

/** Ids present on disk — a missing vendor file simply drops out of the feature. */
export function availableLibs() {
  return LIBS.filter((l) => existsSync(libPath(l))).map((l) => l.id);
}

/** Ids the codegen prompt may offer (present AND scrubbable). */
export function advertisedLibs() {
  return LIBS.filter((l) => l.advertise && existsSync(libPath(l))).map((l) => l.id);
}

/**
 * Which vendored libraries a spec reaches for. Scans script + html + css so a library pulled in
 * from inline markup is caught too. Returns ids in registry order (stable page assembly).
 */
export function detectLibs(spec) {
  if (!spec) return [];
  const text = `${spec.script || ''}\n${spec.html || ''}\n${spec.css || ''}`;
  if (!text.trim()) return [];
  return LIBS.filter((l) => l.probe.test(text) && existsSync(libPath(l))).map((l) => l.id);
}

/** Concatenated library source for the given ids, safe to embed in an inline <script>. */
export function libsBundle(ids = []) {
  const parts = [];
  for (const id of ids) {
    const lib = byId.get(id);
    if (!lib) continue;
    if (!srcCache.has(id)) {
      const p = libPath(lib);
      srcCache.set(id, existsSync(p) ? readFileSync(p, 'utf8') : '');
    }
    const src = srcCache.get(id);
    // A nested "</script" would terminate the inline tag early — escape it, same as gsap.js.
    if (src) parts.push(src.replace(/<\/script/gi, '<\\/script'));
  }
  return parts.join('\n;');
}
