// Static safety/determinism lint for LLM-generated scene specs { css, html, script }.
// Errors → the codegen retries with the message embedded; the renderer never sees bad code.
// The rules protect two contracts:
//   1) determinism — no wall-clock, no self-scheduling, no network; all motion lives on the
//      paused root timeline `tl` (scrubbed by __seek), so direct gsap.* calls are banned too.
//   2) harness integrity — generated markup/JS must not touch the caption/progress/canvas UI.

const SCRIPT_BANNED = [
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'setTimeout/setInterval — mọi timing phải nằm trong tl'],
  [/\brequestAnimationFrame\b/, 'requestAnimationFrame — dùng tween trên tl'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'network API — cảnh phải tự chứa, không tải tài nguyên'],
  [/\bimport\s*\(|\bimportScripts\b|\brequire\s*\(/, 'dynamic import'],
  [/\beval\s*\(|new\s+Function\b/, 'eval/new Function'],
  [/\bDate\s*\.\s*now\b|new\s+Date\b|performance\s*\.\s*now\b/, 'wall-clock time — phá determinism, dùng thời gian tl'],
  [/document\s*\.\s*write\b|location\s*\.|window\s*\.\s*open\b|localStorage\b|sessionStorage\b/, 'DOM/side-effect API bị cấm'],
  [/window\s*\.\s*__|__seek\b|__init\b|__tl\b|__scene\b|__drawBg\b/, 'chạm vào runtime nội bộ của harness'],
  [/\bgsap\s*\.\s*(to|from|fromTo|set|timeline|delayedCall|ticker|globalTimeline|context|matchMedia|effects|getProperty|utils\s*\.\s*random)\b/, 'gsap.* trực tiếp — mọi tween phải qua tl.* hoặc FX.* (globalTimeline bị pause nên gsap.to sẽ đứng im)'],
];
const HTML_BANNED = [
  [/<\s*(script|iframe|object|embed|link|meta|style)\b/i, 'thẻ script/iframe/link/style trong html'],
  [/\son[a-z]+\s*=/i, 'inline event handler (onclick…)'],
  [/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i, 'tài nguyên ngoài (http/https) — cảnh phải offline'],
  [/javascript:/i, 'javascript: URL'],
];
const CSS_BANNED = [
  [/@import\b/i, '@import trong css'],
  [/url\(\s*["']?\s*(?:https?:)?\/\//i, 'url() tới tài nguyên ngoài'],
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
    errors.push('đụng vào selector hạ tầng (.cap/#progFill/#bgCanvas/.progtrack/.wm)');
  }
  if (!html.trim()) errors.push('html rỗng');
  if (!script.trim()) warnings.push('script rỗng — cảnh sẽ chỉ có ambient mặc định');
  else if (!/\b(tl|FX)\s*[.(]/.test(script)) errors.push('script không thêm tween nào vào tl/FX');
  if (css.length > CAP || html.length > CAP || script.length > CAP) errors.push(`spec quá dài (>${CAP} ký tự/field)`);
  if (/Math\s*\.\s*random\b/.test(script)) errors.push('Math.random bị cấm — dùng rng() (PRNG đã seed) để giữ determinism');
  if (/\brepeat\s*:\s*-1\b/.test(script)) warnings.push('repeat:-1 (loop vô hạn) — nên dùng repeat hữu hạn Math.ceil(DUR/period)-1 để timeline kết thúc đúng DUR');
  return { errors, warnings };
}
