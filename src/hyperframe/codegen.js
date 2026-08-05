// Scene spec codegen: prompt → parse (delimiter-fenced, JSON fallback) → lint → assembled-script
// syntax check → render-validation → props. Retries feed validation errors back to the model;
// after maxAttempts (default 10) the loop THROWS — no fallback model, no heuristic template (P25).
//
// Output format is DELIMITER-FENCED, not JSON: weak models constantly break JSON when a string
// field holds code full of quotes/newlines. Fences let the model write CSS/HTML/JS verbatim (zero
// escaping), which all but eliminates parse failures. JSON is still accepted as a fallback.
import { chat } from '../providers/llm.js';
import { buildTemplate, makeCtx } from '../animation/templates.js';
import { getTheme } from '../animation/themes.js';
import { extractBeats, cinematicDirection } from './beats.js';
import { buildCodegenPrompt, overlayBlock } from './prompt.js';
import { lintSpec } from './lint.js';
import { renderValidate } from './validate.js';
import { detectLang } from '../util/lang.js';

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

// Deterministic pre-lint normalizer: fix the mechanical mistakes a weak model repeats so they do
// NOT burn a scarce codegen attempt — infinite CSS animation hard-errors the lint; off-guide fonts
// and <br> ship a cheap look silently. Pure string transforms, meaning unchanged, mutates in place.
export function normalizeSpec(spec, { guide, duration, language = 'vi' }) {
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
  // as leftover dev text, never as real on-screen copy. Then any surviving label is de-snake_cased
  // (DỮ_LIỆU_DƯ_THỪA → DỮ LIỆU DƯ THỪA) so nothing reads like a code identifier.
  //
  // TWO nets, because "telemetry" means different things in different languages:
  //  - STRUCTURAL is always safe: no language writes copy as snake_case, k="v", foo.bar() or x.exe.
  //  - The WORDLIST (STATUS / ACTIVE / SUCCESS / ERROR …) is safe only in a language that does not
  //    use those words as copy. In Vietnamese the diacritic guard below protects real text, so the
  //    wordlist only ever caught decor. On an ENGLISH video there is no such guard, and this
  //    silently blanked legitimate labels — measured: ACTIVE, SUCCESS, ERROR RATE and RUNNING TOTAL
  //    all became empty text nodes BEFORE validation could see them, with nothing in the log.
  const STRUCTURAL = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b[A-Za-z_][\w-]*\s*=\s*(?:"[^"]*"|'[^']*'|[\d,.]+|true|false|null)|\b[a-z_][\w]*(?:\.[a-z_][\w]*)+\s*\([^)]*\)|\b[\w-]+\.(?:exe|sh|js|ts|py|json|dll|bat|cfg|log|sys)\b|\[[A-Z][A-Z0-9_]*\]/;
  const DEV_WORDS = /\b(?:OVERLOAD|OVERFLOW|UNDERFLOW|OFFLINE|ONLINE|LOADING|PROCESSING|ANALYZING|SCANNING|INITIALIZING|REBOOT|LATENCY|BUFFER|KERNEL|DAEMON|STDOUT|STDERR|TIMEOUT|STATUS|ACTIVE|INACTIVE|ENABLED|DISABLED|RUNNING|PENDING|SUCCESS|FAILED|ERROR|WARNING|DEBUG)\b/;
  const wordsAreDecor = language === 'vi'; // English copy legitimately uses these words
  const TOKEN = wordsAreDecor
    ? new RegExp(`${STRUCTURAL.source}|${DEV_WORDS.source}`)
    : STRUCTURAL;
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

/**
 * Media the scene carries. `media` = [{ name, character }]. A picture asset becomes the scene's
 * hero; a brand CHARACTER cutout (P40) is a co-star instead — a transparent mascot blown up to
 * hero size and cropped by object-fit reads as a mistake, so it gets its own placement rules.
 */
export function imageFullBlock(media) {
  const list = (Array.isArray(media) ? media : []).map((m) => (typeof m === 'string' ? { name: m } : m)).filter((m) => m?.name);
  const chars = list.filter((m) => m.character);
  const pics = list.filter((m) => !m.character);
  const out = [`SCENE MEDIA (this scene carries: ${list.map((m) => m.name).join(', ')}) — reference the file with the {{asset:NAME}} placeholder in src, never an invented path.`];
  if (pics.length) {
    out.push(`- HERO PICTURE "${pics[0].name}": place it as the CENTER HERO covering ~75% of the frame — <img class="hf-media" src="{{asset:${pics[0].name}}}"> inside a slot; object-fit:cover; rounded corners (~12px); soft box-shadow (0 20px 60px rgba(0,0,0,.6)).
- Entrance: scale 0.9→1 + fade (power2.out, ~0.6s) at its beat; during hold give it a slow Ken Burns (scale 1→1.05 across the scene, ease:'none').
- Text/keywords overlay ON TOP of the picture with strong text-shadow; keep them near its edges, never covering its center.
- Do NOT stretch it full-bleed and do NOT make it a tiny thumbnail.`);
  }
  if (chars.length) {
    out.push(`- BRAND CHARACTER "${chars[0].name}" is a transparent cutout of the channel's mascot — a CO-STAR beside the message, never the hero and never a background. <img src="{{asset:${chars[0].name}}}" style="height:__px;width:auto"> with NO object-fit, NO crop, NO rounded corners, NO box, NO border and NO background behind it — the alpha edge IS the shape.
- Place it in the LEFT or RIGHT third, standing on the lower half, sized 40–55% of the frame height; the type occupies the opposite side. It must never overlap the headline or the subtitle band.
- Give it life: enter with a slide-in from its own edge + slight overshoot (back.out) at its beat, then a gentle breathing float during the hold (y ±6px, or scale 1↔1.02); a soft drop-shadow filter grounds it (drop-shadow(0 18px 30px rgba(0,0,0,.55))).`);
  }
  out.push('- The stage stays dark behind everything; the media supports the narration, it never replaces the typography.');
  return out.join('\n');
}

/**
 * Generate one scene's hyperframe props. Returns { props, beats, direction, warnings }.
 * Owner's contract (2026-07-17): the PRIMARY model gets up to 10 attempts; when they are
 * exhausted this THROWS and the failure surfaces loudly — no fallback model, no heuristic
 * template (fallback output sits below the quality bar).
 */
export async function generateSceneSpec({ scene, guide, w, h, idx, total, ai, onLog = () => {}, renderCheck = true, maxAttempts = 10, density, creativeDirection, hookVisual = '', captionsOn = true, consistent = false, imageFullAssets = null, overlay = false, diversitySalt = 0, language = '' }) {
  // The video's language decides what goes ON SCREEN. A caller that does not know falls back to
  // this scene's own narration — still right far more often than the old blanket assumption.
  const lang = language || detectLang(scene.voice_text || '');
  const duration = Math.max(1.5, scene.duration || 6);
  const beats = extractBeats(scene.srt_json, scene.keywords, duration);
  const direction = cinematicDirection(scene, idx, total);
  const modeBlocks = [];
  if (overlay) modeBlocks.push(overlayBlock({ edit: overlay === 'edit' }));
  if (consistent) modeBlocks.push(consistentScenesBlock(guide));
  const media = (Array.isArray(imageFullAssets) ? imageFullAssets : []).filter((a) => a?.name && a?.uri);
  if (media.length) modeBlocks.push(imageFullBlock(media));
  const messages = buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual, captionsOn, modeBlocks, diversitySalt });

  let lastErrors = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw;
    try {
      // temperature ladder: precise while fixing (0.45), one notch warmer late in the run
      // (≥6) so a stuck design can escape its local minimum instead of repeating itself.
      const temperature = attempt === 1 ? 0.7 : attempt >= 6 ? 0.65 : 0.45;
      // P39: full-page raw-GSAP specs are bigger than the old FX-constrained ones — give the
      // model room (the reference app sends 100k; providers stop early when done).
      raw = await chat(messages, { maxTokens: 24000, temperature, llm: ai?.llm || null });
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
      messages.length = 2; // bounded history (see below) — one standing format reminder
      messages.push({ role: 'user', content: 'Your reply did not match the format. Reply with EXACTLY the three fenced blocks and nothing else:\n@@@CSS@@@\n(css)\n@@@HTML@@@\n(html)\n@@@SCRIPT@@@\n(js)\n@@@END@@@' });
      continue;
    }
    normalizeSpec(clean, { guide, duration, language: lang }); // reclaim attempts from mechanical mistakes
    const { errors, warnings } = lintSpec(clean, { overlay });
    // static: lint + parse. Cheap — always first.
    if (!errors.length) {
      try { syntaxCheck(clean, guide, { w, h, duration }); }
      catch (e) { errors.push(`script has a syntax error: ${e.message}`); }
    }
    // image-full media lands AFTER lint (placeholders are lint-invisible) and BEFORE the
    // render check, so validation sees the actual inlined hero media.
    if (!errors.length && media.length) applyAssetMedia(clean, media);
    // dynamic: actually render. P39 (reference-parity): the render gate now returns only the HARD
    // STRUCTURAL FLOOR as defects (the script threw / the scene renders blank) — those still
    // re-ask (they are genuinely broken scenes). Every GEOMETRY finding (off-screen / overlap /
    // caption-band / center-clump / wrong-language / junk) is ADVISORY: logged, never a re-ask —
    // matching the reference app, whose validation is advisory. No layout defect burns an attempt.
    let renderDefects = [], renderWarnings = [];
    if (!errors.length && renderCheck) {
      try {
        const rv = await renderValidate({ spec: { ...clean, guide }, guide, w, h, duration, beats, narration: scene.voice_text || '', captionsOn, overlay });
        renderDefects = rv.defects || [];
        renderWarnings = rv.warnings || [];
      } catch (e) { onLog(`cảnh ${idx + 1}: renderValidate lỗi (${String(e.message).slice(0, 60)}) — bỏ qua`); }
    }
    const allIssues = [...errors, ...renderDefects];
    if (!allIssues.length) {
      const advisories = [...warnings, ...renderWarnings];
      if (advisories.length) onLog(`cảnh ${idx + 1}: cảnh báo (không chặn) — ${advisories.join('; ').slice(0, 240)}`);
      // plannedDur: the duration this spec's absolute animation times were authored for.
      // Scenes-first order generates specs against an ESTIMATED timeline; at render the
      // harness time-warps the template timeline by plannedDur/realDur (S.tplScale) so the
      // choreography fills the real voice duration instead of cutting or freezing.
      return { props: { ...clean, guide, beats, plannedDur: duration, canvasW: w, canvasH: h, ...(overlay ? { overlay: true } : {}) }, beats, direction, warnings: advisories };
    }
    lastErrors = allIssues;
    onLog(`cảnh ${idx + 1}: spec chưa đạt (lần ${attempt}/${maxAttempts}) — ${allIssues.join(' | ').slice(0, 240)}`);
    // Keep the conversation BOUNDED across up to 10 attempts: system + original brief +
    // ONLY the latest attempt/fix pair. Older failures add tokens, not signal — the fix
    // note always carries the full current issue list.
    messages.length = 2;
    messages.push({ role: 'assistant', content: `@@@CSS@@@\n${clean.css}\n@@@HTML@@@\n${clean.html}\n@@@SCRIPT@@@\n${clean.script}\n@@@END@@@`.slice(0, 5000) });
    messages.push({
      role: 'user',
      content: `Your scene has problems that must be fixed:\n- ${allIssues.join('\n- ')}\nReturn the corrected scene in the same @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced format — keep what worked, fix only the listed issues.`,
    });
  }
  // P39: geometry is advisory, so the only way to exhaust every attempt is a scene that stays
  // STRUCTURALLY broken (unparseable / syntax error / threw at runtime / renders blank) each time.
  // That is a genuine failure — fail LOUDLY per the no-fallback contract (P25), no template swap.
  throw new Error(`codegen thất bại sau ${maxAttempts} lần: ${lastErrors?.join(' | ').slice(0, 200)}`);
}
