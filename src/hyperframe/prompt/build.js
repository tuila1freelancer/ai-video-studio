// buildCodegenPrompt(): the complete narration and brief verbatim (P19) plus every block above.
import { SAMPLE_SPEC } from '../../styleguide/index.js';
import { HF_ICON_NAMES } from '../icons.js';
import { directionBlock, beatsBlock } from '../beats.js';
import { motionSignature, signatureBlock } from '../signatures.js';
import { langAdjective } from '../../util/lang.js';
import { codegenSystem } from './system.js';
import { DENSITY_NOTE, guideV2Block, scriptTextRule } from './blocks.js';
import { ratioClass, viewportBlock, ratioRulesBlock } from './layout.js';
import { animationSpecBlock, timelineSkeletonBlock, creativeLibsBlock } from './animation.js';

export function buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual = '', captionsOn = true, modeBlocks = [], diversitySalt = 0, language = 'vi' }) {
  const sig = motionSignature(direction, idx, diversitySalt);
  const densityNote = DENSITY_NOTE[density] || DENSITY_NOTE.rich; // rich is the house default — sparse scenes read cheap
  const subNote = captionsOn
    ? 'SUBTITLES: ON — karaoke subtitles run along the bottom. Keep the PRIMARY headline out of that band; everything else (structure, panels, ambience, short labels) may extend into it. Never leave the bottom third empty just to avoid the subtitles.'
    : 'SUBTITLES: OFF for this video — there is NO subtitle band; use the FULL frame height (still keep a comfortable ~6% margin from every edge).';
  const dirNote = (creativeDirection || '').trim()
    ? `\nCREATIVE DIRECTION (apply to every scene of this video): ${creativeDirection.trim()}` : '';
  const rhymeNote = direction.isClimax && (hookVisual || '').trim()
    ? `\nVISUAL RHYME (closing scene): echo the hook scene's main motif — "${hookVisual.trim().slice(0, 220)}" — bring its main object/shape back BIGGER (~+25% scale) with a stronger glow as the final climax element.` : '';
  const modeNote = modeBlocks.length ? `\n${modeBlocks.join('\n')}` : '';
  const user = `STYLE GUIDE (LOCKED — use exactly these):
- Palette: bg ${guide.palette.bg} / bg2 ${guide.palette.bg2} · ink ${guide.palette.ink} · muted ${guide.palette.muted} · accents ${guide.palette.accents.join(' ')}
- Display font: ${guide.fonts.display} · Body: ${guide.fonts.body} · Mono: ${guide.fonts.mono}
- Keyword treatment: ${guide.textTreatment} (already baked into .hf-kw) · Background motif: ${guide.motif} (already rendered behind you)
- Motion personality: ${guide.motionPersonality}${guideV2Block(guide)}
${densityNote}${dirNote}${rhymeNote}${modeNote}

SCENE ${idx + 1}/${total} — CANVAS ${w}x${h} CSS px (${ratioClass(w, h)}), DUR = ${(+duration).toFixed(3)}s
${viewportBlock(w, h, captionsOn)}
${ratioRulesBlock(w, h)}${scriptTextRule(scene.voice_text, language)}
${subNote}
ON-SCREEN LANGUAGE: ${langAdjective(language)} — every readable word you write below is ${langAdjective(language)}. Numbers, units and symbols are language-free.
NARRATION (voice${captionsOn ? ', shown as karaoke subtitles at the bottom' : ' — subtitles are OFF, not shown on screen'} — do NOT repeat it verbatim on screen):
"${(scene.voice_text || '').trim()}"
VISUAL CONCEPT (an art-director's brief — let it INSPIRE your design: match its subject and its energy, but the exact composition, styling and execution are YOURS to invent, and two scenes must never come out alike; when it is structured [ROLE]/[LAYOUT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[MOOD], read the [ROLE] for energy — a titlecard/cta means restraint, a hook means maximum striking power — the beat times below still rule WHEN things appear):
"${(scene.visual_prompt || '').trim() || '(design freely from the narration keywords)'}"

CINEMATIC DIRECTION:
${directionBlock(direction)}

${signatureBlock(sig)}

${animationSpecBlock(direction, sig, beats, duration)}

${timelineSkeletonBlock(beats, direction, duration)}

BEAT TIMELINE (from the real voice word-timestamps — the visual for each beat must appear at t0 and be gone by t1):
${beatsBlock(beats, duration)}

ICONS available (use as {{icon:name}}): ${HF_ICON_NAMES.join(', ')}
${creativeLibsBlock()}

EXAMPLE — ONE scene in the required FENCED FORMAT. Study the format and the technical shape ONLY; do NOT copy its layout, its content, or its style — your scene must look nothing like it. Its on-screen text is numbers and symbols on purpose, so it cannot suggest a language: YOUR words come from the narration, written in ${langAdjective(language)}:
@@@CSS@@@
${SAMPLE_SPEC.css.trim()}
@@@HTML@@@
${SAMPLE_SPEC.html.trim()}
@@@SCRIPT@@@
${SAMPLE_SPEC.script.trim()}
@@@END@@@

Now design THIS scene — your own unique composition, true to the narration, balanced across the frame, beautifully and smoothly animated, every word readable. Reply with ONLY the @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced blocks.`;
  return [
    { role: 'system', content: codegenSystem(language) },
    { role: 'user', content: user },
  ];
}
