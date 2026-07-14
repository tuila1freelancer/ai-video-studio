// Static safety/determinism lint for LLM-generated scene specs { css, html, script }.
// Errors → the codegen retries with the message embedded; the renderer never sees bad code.
// The rules protect two contracts:
//   1) determinism — no wall-clock, no self-scheduling, no network; all motion lives on the
//      paused root timeline `tl` (scrubbed by __seek), so direct gsap.* calls are banned too.
//   2) harness integrity — generated markup/JS must not touch the caption/progress/canvas UI.

const SCRIPT_BANNED = [
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'setTimeout/setInterval — all timing must live on tl'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame — use tweens on tl instead'],
  [/\baddEventListener\s*\(/, 'addEventListener — the renderer has no input events; drive everything from tl'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'network API — the scene must be self-contained, no loading resources'],
  [/\bimport\s*\(|\bimportScripts\b|\brequire\s*\(/, 'dynamic import'],
  [/\beval\s*\(|new\s+Function\b/, 'eval/new Function'],
  [/\bDate\s*\.\s*now\b|new\s+Date\b|performance\s*\.\s*now\b/, 'wall-clock time — breaks determinism, use tl time'],
  [/document\s*\.\s*write\b|location\s*\.|window\s*\.\s*open\b|localStorage\b|sessionStorage\b/, 'banned DOM/side-effect API'],
  [/window\s*\.\s*__|__seek\b|__init\b|__tl\b|__scene\b|__drawBg\b/, 'touches the harness internal runtime'],
  [/\bgsap\s*\.\s*(to|from|fromTo|set|timeline|delayedCall|ticker|globalTimeline|context|matchMedia|effects|getProperty|utils\s*\.\s*random)\b/, 'direct gsap.* call — every tween must go through tl.* or FX.* (globalTimeline is paused, so gsap.to would freeze)'],
  [/\brepeat\s*:\s*-1\b/, 'repeat:-1 (infinite loop) — use a finite count: repeat: Math.max(0, Math.floor(DUR/period) - 1) so the timeline ends exactly at DUR'],
];
// Non-interpolable / layout motion in ANIMATED tweens only — tl.set() stays legal (an instant
// set is seek-safe; e.g. hiding a finished group with set({display:'none'}) at a beat time).
// display/visibility can't interpolate; width/height/top/left reflow every frame and can
// re-wrap text mid-tween — the allowlist is opacity + transforms + color/borderRadius.
const DISPLAY_TWEEN = /\.\s*(?:to|from|fromTo)\s*\([^)]{0,220}?[{,]\s*(?:display|visibility)\s*:/s;
const LAYOUT_TWEEN = /\.\s*(?:to|from|fromTo)\s*\([^)]{0,220}?[{,]\s*(?:width|height|top|left)\s*:/s;
// getBoundingClientRect inside a per-frame callback re-measures during sampling — positions
// must be computed ONCE at setup (the script body runs once while building tl, which is fine).
const GBCR_IN_CALLBACK = /on(?:Update|Start|Complete|Repeat)\s*[:(][\s\S]{0,300}?getBoundingClientRect/;
const HTML_BANNED = [
  [/<\s*(script|iframe|object|embed|link|meta|style)\b/i, 'script/iframe/link/style tag inside html'],
  [/\son[a-z]+\s*=/i, 'inline event handler (onclick…)'],
  [/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i, 'external resource (http/https) — the scene must be offline'],
  [/javascript:/i, 'javascript: URL'],
];
const CSS_BANNED = [
  [/@import\b/i, '@import in css'],
  [/url\(\s*["']?\s*(?:https?:)?\/\//i, 'url() pointing to an external resource'],
  [/animation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/i, 'infinite CSS animation — CSS animations run on the wall clock, not __seek, so frames become nondeterministic; drive motion from tl/FX instead'],
];
// generated code must not restyle/reselect the harness UI layers (caption/progress/canvas/watermark/
// vignette). HyperFrame's own .hf-vig / .hf-grain are allowed — the leading '.' in '.vig' never
// matches '.hf-vig' (which contains '-vig', not '.vig'), so the template layers are untouched.
const PROTECTED_SEL = /(\.cap|#capText|#progFill|\.progtrack|#bgCanvas|\.wm|\.vig)(?![\w-])/;

const CAP = 24000; // chars per field — a scene spec should be small

export function lintSpec(spec) {
  const errors = [], warnings = [];
  const css = String(spec.css || ''), html = String(spec.html || ''), script = String(spec.script || '');
  for (const [re, msg] of SCRIPT_BANNED) if (re.test(script)) errors.push(`script: ${msg}`);
  for (const [re, msg] of HTML_BANNED) if (re.test(html)) errors.push(`html: ${msg}`);
  for (const [re, msg] of CSS_BANNED) if (re.test(css)) errors.push(`css: ${msg}`);
  if (PROTECTED_SEL.test(script) || PROTECTED_SEL.test(css) || PROTECTED_SEL.test(html)) {
    errors.push('touches a harness infrastructure selector (.cap/#progFill/#bgCanvas/.progtrack/.wm)');
  }
  if (!html.trim()) errors.push('html is empty');
  if (!script.trim()) warnings.push('script is empty — the scene will only have the default ambient motion');
  else if (!/\b(tl|FX)\s*[.(]/.test(script)) errors.push('script adds no tween to tl/FX');
  if (css.length > CAP || html.length > CAP || script.length > CAP) errors.push(`spec too long (>${CAP} chars/field)`);
  if (/Math\s*\.\s*random\b/.test(script)) errors.push('Math.random is banned — use rng() (the seeded PRNG) to keep determinism');
  if (DISPLAY_TWEEN.test(script)) {
    errors.push('script ANIMATES display/visibility (not interpolable) — fade with opacity, or flip instantly with tl.set(...) at the beat time');
  }
  if (LAYOUT_TWEEN.test(script)) {
    errors.push('script animates width/height/top/left — animate transforms instead (scaleX with transform-origin for fills, x/y for movement); layout tweens reflow and can re-wrap text mid-tween');
  }
  if (GBCR_IN_CALLBACK.test(script)) {
    errors.push('getBoundingClientRect inside an onUpdate/onStart callback — measure ONCE at setup and reuse the constant');
  }
  // duplicate ids render blank downstream (elements are targeted by id) and break tween selectors
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) errors.push(`duplicate id in html: ${dupes.slice(0, 4).join(', ')} — every id must be unique`);
  if (/<br\s*\/?>/i.test(html)) {
    warnings.push('<br> in body text double-wraps against real font metrics — let text wrap via max-width');
  }
  if (/\.\s*from\s*\([^)]{0,200}?[{,]\s*opacity\s*:\s*1\b/s.test(script)) {
    warnings.push('from({opacity:1}) is a no-op — a fade-in starts from opacity:0');
  }
  return { errors, warnings };
}
