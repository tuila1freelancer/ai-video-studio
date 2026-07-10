// GSAP 3.13 vendored bundle (all premium plugins are free since Webflow acquired GSAP).
// Inlined into scene pages so animation templates can build one paused root timeline
// that the harness scrubs deterministically with tl.time(t, true).
//
// Determinism rules for template scripts (enforced by the harness):
//  - everything goes into the pre-created paused root timeline `tl` (window.__tl)
//  - gsap.globalTimeline is paused after init → any stray gsap.to() freezes instead of drifting
//  - Math.random is re-seeded from the scene seed before the template script runs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_DIR } from '../config/paths.js';

// CustomEase must precede CustomWiggle/CustomBounce (they build on it).
const FILES = [
  'gsap.min.js', 'EasePack.min.js', 'CustomEase.min.js', 'CustomWiggle.min.js', 'CustomBounce.min.js',
  'SplitText.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'MotionPathPlugin.min.js',
  'Physics2DPlugin.min.js', 'ScrambleTextPlugin.min.js', 'TextPlugin.min.js', 'Flip.min.js',
];

const REGISTER = `
(function(){
  var g = window.gsap; if (!g) return;
  var names = ['CustomEase','CustomWiggle','CustomBounce','SplitText','DrawSVGPlugin','MorphSVGPlugin','MotionPathPlugin','Physics2DPlugin','ScrambleTextPlugin','TextPlugin','Flip','EasePack'];
  var list = [];
  for (var i = 0; i < names.length; i++) if (window[names[i]]) list.push(window[names[i]]);
  try { g.registerPlugin.apply(g, list); } catch (e) {}
  try { g.ticker.lagSmoothing(0); } catch (e) {}
})();`;

let bundleCache = null;
export function gsapBundle() {
  if (bundleCache == null) {
    const parts = [];
    for (const f of FILES) {
      const p = join(VENDOR_DIR, 'gsap', f);
      if (existsSync(p)) parts.push(readFileSync(p, 'utf8'));
    }
    // </script> would terminate the inline tag early — escape it inside string literals.
    bundleCache = parts.length ? (parts.join('\n;') + REGISTER).replace(/<\/script/gi, '<\\/script') : '';
  }
  return bundleCache;
}

export function gsapAvailable() {
  return existsSync(join(VENDOR_DIR, 'gsap', 'gsap.min.js'));
}
