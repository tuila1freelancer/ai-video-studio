// Scene spec codegen: prompt → parse (delimiter-fenced, JSON fallback) → lint → assembled-script
// syntax check → render-validation → props. Retries feed validation errors back to the model; the
// caller falls back to the classic heuristic planner if this still fails — the pipeline never dies.
//
// Output format is DELIMITER-FENCED, not JSON: weak models constantly break JSON when a string
// field holds code full of quotes/newlines. Fences let the model write CSS/HTML/JS verbatim (zero
// escaping), which all but eliminates parse failures. JSON is still accepted as a fallback.
import { chat } from '../providers/llm.js';
import { buildTemplate, makeCtx } from '../animation/templates.js';
import { getTheme } from '../animation/themes.js';
import { extractBeats, cinematicDirection } from './beats.js';
import { buildCodegenPrompt } from './prompt.js';
import { lintSpec } from './lint.js';
import { renderValidate } from './validate.js';

// Parse a codegen reply into {css,html,script} or null. Delimiter format first, JSON fallback.
export function parseSpec(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim(); // unwrap a whole-reply fence
  const m = /@@@\s*CSS\s*@@@\r?\n?([\s\S]*?)@@@\s*HTML\s*@@@\r?\n?([\s\S]*?)@@@\s*SCRIPT\s*@@@\r?\n?([\s\S]*?)(?:@@@\s*END\s*@@@|$)/i.exec(s);
  if (m) {
    const html = m[2].trim();
    if (html) return { css: m[1].trim(), html, script: m[3].trim() };
  }
  // JSON fallback (model ignored the format): slice first { … last }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(s.slice(a, b + 1));
      if (j && typeof j.html === 'string') return { css: String(j.css || ''), html: j.html, script: String(j.script || '') };
    } catch { /* not JSON either */ }
  }
  return null;
}

// A render defect is "hard" (wrong content/layout — never ship) vs "soft" (cosmetic timing).
const HARD_DEFECT = /off-screen|bottom of the frame|wrong language|renders empty|goes empty|threw at runtime|overlap each other|unreadable|is clipped|is covered|sentence fragment/i;

// Deterministic pre-lint normalizer: fix the mechanical mistakes a weak model repeats so they do
// NOT burn a scarce codegen attempt — infinite CSS animation hard-errors the lint; off-guide fonts
// and <br> ship a cheap look silently. Pure string transforms, meaning unchanged, mutates in place.
export function normalizeSpec(spec, { guide, duration }) {
  const iter = Math.max(8, Math.ceil((duration || 6) / 0.15)); // finite count that always covers DUR
  const OFF = /\b(Inter|Roboto|Poppins|Montserrat|Lato|Nunito|Open Sans|Raleway|Ubuntu|Work Sans|Source Sans(?: Pro)?)\b/gi;
  const body = String(guide?.fonts?.body || 'sans-serif').replace(/'/g, '');
  // <br> in body text → space (wrap on real font metrics, not a hard double-wrap)
  spec.html = String(spec.html || '').replace(/<br\s*\/?>/gi, ' ')
    // stray [SRC=...] placeholders + inline event handlers a weak model sometimes emits
    .replace(/\[SRC\s*=\s*[^\]]*\]/gi, '').replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    // off-guide font only inside inline font-family declarations (never in visible content)
    .replace(/font-family\s*:\s*[^;"'}]*/gi, (m) => m.replace(OFF, body));
  // Strip faint English/code WATERMARK decor the weak model sprinkles behind scenes
  // (PROMPT_OVERFLOW, ERROR_502, [SYSTEM_INIT] x=true, foo.bar(), NAME.EXE) — code tokens read
  // as leftover dev text, never as Vietnamese on-screen copy. Blanks a text node ONLY when it is
  // ENTIRELY such tokens (no real letter/digit survives the strip), so real copy stays intact.
  const CODE_DECOR = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+(?:\.[A-Za-z]{2,4})?\b|\b[\w-]+\.(?:exe|sh|js|ts|py|json|dll|bat|cfg|log|sys)\b|\b[a-z_]{2,}(?:\.[a-z_]{2,})?\s*\([^)]*\)|\[[A-Z][A-Z0-9_]*\]|\b[\w-]+\s*=\s*(?:true|false|null|\d+)\b/g;
  spec.html = spec.html.replace(/>([^<>]+)</g, (seg, txt) => {
    const noCode = txt.replace(CODE_DECOR, '');
    if (noCode === txt) return seg; // no code tokens → keep verbatim
    return noCode.replace(/[^\p{L}\p{N}]/gu, '') ? seg : '><'; // real content remains → keep; pure code → blank
  });
  // infinite CSS animation → a large finite count (deterministic under currentTime scrubbing)
  spec.css = String(spec.css || '').replace(/\binfinite\b/gi, String(iter))
    .replace(/font-family\s*:\s*[^;}]*/gi, (m) => m.replace(OFF, body));
}

function syntaxCheck(spec, guide, { w, h, duration }) {
  // compile the FULL assembled script (FX prelude + spec.script) exactly as the page will run it
  const ctx = makeCtx({ w, h, theme: getTheme('neon-tech'), seed: 1, duration, idx: 0 });
  const tpl = buildTemplate('hyperframe', { ...spec, guide }, ctx);
  if (!tpl.css || !tpl.html) throw new Error('spec builds empty css/html');
  new Function('gsap', 'tl', 'S', 'rng', tpl.script); // throws SyntaxError on bad JS
}

/**
 * Generate one scene's hyperframe props. Returns { props, beats, direction, warnings }.
 * Throws after all attempts fail (caller decides the fallback).
 */
export async function generateSceneSpec({ scene, guide, w, h, idx, total, ai, onLog = () => {}, renderCheck = true, maxAttempts = 4, density, creativeDirection, hookVisual = '' }) {
  const duration = Math.max(1.5, scene.duration || 6);
  const beats = extractBeats(scene.srt_json, scene.keywords, duration);
  const direction = cinematicDirection(scene, idx, total);
  const messages = buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual });

  let lastErrors = null, lastGood = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let rvRan = false, contrastRepaired = false; // per-attempt verification state (→ quality tier)
    let raw;
    try {
      raw = await chat(messages, { maxTokens: 6500, temperature: attempt === 1 ? 0.7 : 0.45, llm: ai?.llm || null });
    } catch (e) {
      lastErrors = [`LLM error: ${String(e.message).slice(0, 80)}`];
      onLog(`cảnh ${idx + 1}: LLM lỗi (lần ${attempt}/${maxAttempts}) — thử lại`);
      continue;
    }
    const clean = parseSpec(raw);
    if (!clean) {
      // Unparseable reply must NOT kill the scene — cost it one attempt and re-instruct the format.
      lastErrors = ['reply did not match the required format'];
      onLog(`cảnh ${idx + 1}: reply sai định dạng (lần ${attempt}/${maxAttempts}) — thử lại`);
      messages.push({ role: 'user', content: 'Your reply did not match the format. Reply with EXACTLY the three fenced blocks and nothing else:\n@@@CSS@@@\n(css)\n@@@HTML@@@\n(html)\n@@@SCRIPT@@@\n(js)\n@@@END@@@' });
      continue;
    }
    normalizeSpec(clean, { guide, duration }); // reclaim attempts from mechanical mistakes
    const { errors, warnings } = lintSpec(clean);
    // static: lint + parse. Cheap — always first.
    if (!errors.length) {
      try { syntaxCheck(clean, guide, { w, h, duration }); }
      catch (e) { errors.push(`script has a syntax error: ${e.message}`); }
    }
    // dynamic: actually render and check runtime + geometry invariants (only if static passed).
    let renderDefects = [];
    if (!errors.length && renderCheck) {
      try {
        const rv = await renderValidate({ spec: { ...clean, guide }, guide, w, h, duration, beats, narration: scene.voice_text || '' });
        if (!rv.skipped) rvRan = true; // Chrome-less runs return skipped:true → tier stays 'unverified'
        if (!rv.ok) renderDefects = rv.defects;
        // Auto-contrast repair: unreadable text is a deterministic colour mistake — force the
        // named element(s) to the guide ink + drop-shadow and re-validate ONCE, rather than
        // dropping an otherwise-good bespoke scene to the plain fallback template (the #1 cause
        // of a lone "plain" scene in an otherwise premium video on weaker models).
        if (!rv.ok && rv.contrastFix?.length && renderDefects.some((d) => /unreadable/.test(d))) {
          const ink = guide.palette.ink;
          const fixCss = rv.contrastFix
            .map((c) => `${c.sel}{color:${ink}!important;-webkit-text-fill-color:${ink}!important;text-shadow:0 2px 12px rgba(0,0,0,.9)!important;opacity:1!important}`)
            .join('\n');
          const candidateCss = `${clean.css || ''}\n/* auto-contrast repair */\n${fixCss}`;
          const rv2 = await renderValidate({ spec: { ...clean, css: candidateCss, guide }, guide, w, h, duration, beats, narration: scene.voice_text || '' });
          if (!rv2.defects.some((d) => /unreadable/.test(d))) {
            clean.css = candidateCss;
            renderDefects = rv2.defects;
            contrastRepaired = true; // shipped after a deterministic repair → tier 'repaired'
            if (!rv2.skipped) rvRan = true;
            onLog(`cảnh ${idx + 1}: auto-contrast repair (${rv.contrastFix.length} phần tử) — ${rv2.ok ? 'đạt' : 'còn ' + rv2.defects.length + ' vấn đề khác'}`);
          }
        }
      } catch (e) { onLog(`cảnh ${idx + 1}: renderValidate lỗi (${String(e.message).slice(0, 60)}) — bỏ qua`); }
      // Keep as the graceful fallback ONLY if defects are cosmetic (timing) — never ship a scene
      // with a HARD defect (off-screen / caption collision / invented text / empty / runtime error);
      // those fall back to the heuristic template instead.
      if (!errors.length && !HARD_DEFECT.test(renderDefects.join(' | '))) lastGood = clean;
    } else if (!errors.length) {
      lastGood = clean;
    }
    const allIssues = [...errors, ...renderDefects];
    if (!allIssues.length) {
      if (warnings.length) onLog(`cảnh ${idx + 1}: cảnh báo lint — ${warnings.join('; ')}`);
      // plannedDur: the duration this spec's absolute animation times were authored for.
      // Scenes-first order generates specs against an ESTIMATED timeline; at render the
      // harness time-warps the template timeline by plannedDur/realDur (S.tplScale) so the
      // choreography fills the real voice duration instead of cutting or freezing.
      // quality tier persisted per scene (G2): 'premium' = rendered clean; 'repaired' = shipped
      // after the deterministic contrast fix; 'unverified' = no headless verdict (Chrome-less).
      const tier = !renderCheck ? 'unverified' : (contrastRepaired ? 'repaired' : (rvRan ? 'premium' : 'unverified'));
      return { props: { ...clean, guide, beats, plannedDur: duration, canvasW: w, canvasH: h }, beats, direction, warnings, tier };
    }
    lastErrors = allIssues;
    onLog(`cảnh ${idx + 1}: spec chưa đạt (lần ${attempt}/${maxAttempts}) — ${allIssues.join(' | ').slice(0, 240)}`);
    messages.push({ role: 'assistant', content: `@@@CSS@@@\n${clean.css}\n@@@HTML@@@\n${clean.html}\n@@@SCRIPT@@@\n${clean.script}\n@@@END@@@`.slice(0, 5000) });
    messages.push({
      role: 'user',
      content: `Your scene has problems that must be fixed:\n- ${allIssues.join('\n- ')}\nReturn the corrected scene in the same @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced format — keep what worked, fix only the listed issues.`,
    });
  }
  // Last resort before the heuristic fallback: if some earlier attempt at least rendered without a
  // hard runtime error, ship it (a slightly-imperfect real scene beats a generic template).
  if (lastGood) {
    onLog(`cảnh ${idx + 1}: dùng spec tốt nhất đạt được (còn cảnh báo hình học sau ${maxAttempts} lần)`);
    return { props: { ...lastGood, guide, beats, plannedDur: duration, canvasW: w, canvasH: h }, beats, direction, warnings: ['render-imperfect'], tier: 'imperfect' };
  }
  throw new Error(`codegen thất bại sau ${maxAttempts} lần: ${lastErrors?.join(' | ').slice(0, 200)}`);
}
