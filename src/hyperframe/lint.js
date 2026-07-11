// Static safety/determinism lint for LLM-generated scene specs { css, html, script }.
// Errors → the codegen retries with the message embedded; the renderer never sees bad code.
// The rules protect two contracts:
//   1) determinism — no wall-clock, no self-scheduling, no network; all motion lives on the
//      paused root timeline `tl` (scrubbed by __seek), so direct gsap.* calls are banned too.
//   2) harness integrity — generated markup/JS must not touch the caption/progress/canvas UI.

const SCRIPT_BANNED = [
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'setTimeout/setInterval — all timing must live on tl'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame — use tweens on tl instead'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'network API — the scene must be self-contained, no loading resources'],
  [/\bimport\s*\(|\bimportScripts\b|\brequire\s*\(/, 'dynamic import'],
  [/\beval\s*\(|new\s+Function\b/, 'eval/new Function'],
  [/\bDate\s*\.\s*now\b|new\s+Date\b|performance\s*\.\s*now\b/, 'wall-clock time — breaks determinism, use tl time'],
  [/document\s*\.\s*write\b|location\s*\.|window\s*\.\s*open\b|localStorage\b|sessionStorage\b/, 'banned DOM/side-effect API'],
  [/window\s*\.\s*__|__seek\b|__init\b|__tl\b|__scene\b|__drawBg\b/, 'touches the harness internal runtime'],
  [/\bgsap\s*\.\s*(to|from|fromTo|set|timeline|delayedCall|ticker|globalTimeline|context|matchMedia|effects|getProperty|utils\s*\.\s*random)\b/, 'direct gsap.* call — every tween must go through tl.* or FX.* (globalTimeline is paused, so gsap.to would freeze)'],
];
const HTML_BANNED = [
  [/<\s*(script|iframe|object|embed|link|meta|style)\b/i, 'script/iframe/link/style tag inside html'],
  [/\son[a-z]+\s*=/i, 'inline event handler (onclick…)'],
  [/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i, 'external resource (http/https) — the scene must be offline'],
  [/javascript:/i, 'javascript: URL'],
];
const CSS_BANNED = [
  [/@import\b/i, '@import in css'],
  [/url\(\s*["']?\s*(?:https?:)?\/\//i, 'url() pointing to an external resource'],
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
  if (/\brepeat\s*:\s*-1\b/.test(script)) warnings.push('repeat:-1 (infinite loop) — prefer a finite repeat Math.ceil(DUR/period)-1 so the timeline ends exactly at DUR');
  return { errors, warnings };
}
