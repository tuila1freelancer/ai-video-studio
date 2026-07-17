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
  // Strip faint English/code TELEMETRY watermark decor the weak model sprinkles behind scenes
  // (limit_1024, ai_state="LOST_FOCUS", PROMPT_OVERFLOW, OVERLOAD, foo.bar(), NAME.EXE) — these read
  // as leftover dev text, never as Vietnamese on-screen copy. A text node is blanked ONLY when it
  // carries a code/telemetry token AND has NO Vietnamese diacritic, so real Vietnamese copy (which
  // carries diacritics, or has no such token) is always kept. Then any surviving label is
  // de-snake_cased (DỮ_LIỆU_DƯ_THỪA → DỮ LIỆU DƯ THỪA) so nothing reads like a code identifier.
  const TOKEN = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b[A-Za-z_][\w-]*\s*=\s*(?:"[^"]*"|'[^']*'|[\d,.]+|true|false|null)|\b[a-z_][\w]*(?:\.[a-z_][\w]*)+\s*\([^)]*\)|\b[\w-]+\.(?:exe|sh|js|ts|py|json|dll|bat|cfg|log|sys)\b|\[[A-Z][A-Z0-9_]*\]|\b(?:OVERLOAD|OVERFLOW|UNDERFLOW|OFFLINE|ONLINE|LOADING|PROCESSING|ANALYZING|SCANNING|INITIALIZING|REBOOT|LATENCY|BUFFER|KERNEL|DAEMON|STDOUT|STDERR|TIMEOUT|STATUS|ACTIVE|INACTIVE|ENABLED|DISABLED|RUNNING|PENDING|SUCCESS|FAILED|ERROR|WARNING|DEBUG)\b/;
  const VN = /[À-ỿ]/; // a Latin-with-diacritic char ⇒ Vietnamese content, never a code token
  spec.html = spec.html
    .replace(/>([^<>]+)</g, (seg, txt) => (txt.includes('{{') ? seg : (TOKEN.test(txt) && !VN.test(txt) ? '><' : seg)))
    .replace(/>([^<>]+)</g, (seg, txt) => (txt.includes('{{') ? seg : `>${txt.replace(/(\p{L})_(?=\p{L})/gu, '$1 ')}<`));
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

// Reference-app mode blocks (its #33 / #68), adapted to our guide-locked stage.
export function consistentScenesBlock(guide) {
  return `CONSISTENT SCENES MODE (hard):
- Scene surfaces stay on the guide background ${guide.palette.bg} (panels may use ${guide.palette.bg2}) — never invent another backdrop tone.
- The PRIMARY headline/hero text of every scene uses the FIRST accent ${guide.palette.accents[0]} (or ink ${guide.palette.ink}); supporting text stays ink/muted.
- No new colors beyond the locked palette. Every scene of this video must share the same background and primary text color.`;
}
// Post-lint media substitution: {{asset:NAME}} placeholders (image-full lane) become the
// resolved data URIs; unresolved placeholders are stripped (and an <img> whose src stayed
// unresolved is removed entirely) so a hallucinated asset name can never 404 the render.
export function applyAssetMedia(spec, assets = []) {
  let html = String(spec.html || '');
  for (const a of assets) {
    if (!a?.name || !a?.uri) continue;
    const re = new RegExp(`\\{\\{\\s*asset\\s*:\\s*${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi');
    html = html.replace(re, a.uri);
  }
  html = html.replace(/<img\b[^>]*\{\{\s*asset\s*:[^}]*\}\}[^>]*>/gi, '').replace(/\{\{\s*asset\s*:[^}]*\}\}/gi, '');
  spec.html = html;
}

export function imageFullBlock(assetNames) {
  return `IMAGE FULL MODE (this scene carries project media: ${assetNames.join(', ')}):
- Place the FIRST listed media as the CENTER HERO covering ~75% of the frame: <img class="hf-media" src="{{asset:${assetNames[0]}}}"> inside a slot; object-fit:cover; rounded corners (~12px); soft box-shadow (0 20px 60px rgba(0,0,0,.6)).
- Entrance: scale 0.9→1 + fade (power2.out, ~0.6s) at its beat; during hold give it a slow Ken Burns (scale 1→1.05 across the scene, ease:'none').
- Text/keywords overlay ON TOP of the media with strong text-shadow; keep them near the edges of the media, never covering its center.
- The stage stays dark behind it; do NOT stretch the media full-bleed and do NOT make it a tiny thumbnail.`;
}

/**
 * Generate one scene's hyperframe props. Returns { props, beats, direction, warnings }.
 * Throws after all attempts fail (caller decides the fallback).
 */
export async function generateSceneSpec({ scene, guide, w, h, idx, total, ai, onLog = () => {}, renderCheck = true, maxAttempts = 4, density, creativeDirection, hookVisual = '', captionsOn = true, consistent = false, imageFullAssets = null }) {
  const duration = Math.max(1.5, scene.duration || 6);
  const beats = extractBeats(scene.srt_json, scene.keywords, duration);
  const direction = cinematicDirection(scene, idx, total);
  const modeBlocks = [];
  if (consistent) modeBlocks.push(consistentScenesBlock(guide));
  const media = (Array.isArray(imageFullAssets) ? imageFullAssets : []).filter((a) => a?.name && a?.uri);
  if (media.length) modeBlocks.push(imageFullBlock(media.map((a) => a.name)));
  const messages = buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual, captionsOn, modeBlocks });

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
    // Debug tap (env AVS_CODEGEN_DUMP=dir): persist every raw attempt for post-mortems —
    // failed attempts are otherwise lost, which makes model-behavior bugs unreproducible.
    if (process.env.AVS_CODEGEN_DUMP) {
      try {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        mkdirSync(process.env.AVS_CODEGEN_DUMP, { recursive: true });
        writeFileSync(`${process.env.AVS_CODEGEN_DUMP}/scene${idx + 1}_attempt${attempt}.txt`, String(raw || ''));
      } catch { /* debug tap must never break codegen */ }
    }
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
    // image-full media lands AFTER lint (placeholders are lint-invisible) and BEFORE the
    // render check, so validation sees the actual inlined hero media.
    if (!errors.length && media.length) applyAssetMedia(clean, media);
    // dynamic: actually render and check runtime + geometry invariants (only if static passed).
    let renderDefects = [];
    if (!errors.length && renderCheck) {
      try {
        const rv = await renderValidate({ spec: { ...clean, guide }, guide, w, h, duration, beats, narration: scene.voice_text || '', captionsOn });
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
          const rv2 = await renderValidate({ spec: { ...clean, css: candidateCss, guide }, guide, w, h, duration, beats, narration: scene.voice_text || '', captionsOn });
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
