// Per-scene MOTION SIGNATURE — a named visual "personality" that varies scene-to-scene so a
// video never reads as one template stamped N times. Distilled from the reference channel's
// mood/energy visual-style layer (Swiss / Velvet / Maximalist / Shadow-cut / Data-drift) and
// adapted to our palette-driven guide: a signature dictates MOTION FEEL, typography weight and
// hero treatment — NEVER fixed colors (those stay locked to the style guide). It is selected
// deterministically from the scene's already-computed cinematic direction, so identical input
// renders identical frames (determinism is sacred in this pipeline).

export const SIGNATURES = {
  'maximalist-impact': {
    name: 'MAXIMALIST IMPACT',
    feel: 'loud, kinetic — the type IS the visual',
    ease: 'hard arrivals and hard stops (expo.out; the single accent beat may back.out(1.6))',
    type: 'hero keyword 70–85% of the frame width, ultra-bold, layered scales',
    hero: 'giant kinetic typography as the subject, with a burst/flash on the payoff word',
    avoid: 'empty backgrounds, small timid type, slow dissolves',
  },
  'shadow-cut': {
    name: 'SHADOW CUT',
    feel: 'dark, cinematic — the pause carries the weight',
    ease: 'power3.out reveals, power4.in exits; let beats breathe between hits',
    type: 'sharp high-contrast display type, heavy weight, film title-card framing',
    hero: 'one dominant object under a deep vignette with a single concentrated accent glow',
    avoid: 'bright flat colors, busy simultaneous motion, playful bounce',
  },
  'velvet-glide': {
    name: 'VELVET GLIDE',
    feel: 'premium, timeless — nothing snaps, everything glides',
    ease: 'sine.inOut / power2 — long, smooth, weightless settles',
    type: 'wide letter-spacing, elegant caps, a chrome sheen crossing the hero',
    hero: 'a glass-panel composition or refined data card lit by a slow light sweep',
    avoid: 'fast jerks, crowded layouts, harsh overshoot',
  },
  'swiss-precision': {
    name: 'SWISS PRECISION',
    feel: 'clinical, confident — snap into place, then hold perfectly still',
    ease: 'power4.out fast snap; nothing floats aimlessly',
    type: 'huge numerals paired with tight mono labels, generous whitespace',
    hero: 'a big measured stat or diagram on a clean grid, exactly one accent',
    avoid: 'decorative fluff, gradients everywhere, cluttered frames',
  },
  'data-drift': {
    name: 'DATA DRIFT',
    feel: 'futuristic, immersive — a living HUD instrument',
    ease: 'sine.inOut / power2.out — smooth continuous drift, never static',
    type: 'thin futuristic labels, tabular numerals, scan-line accents',
    hero: 'a node graph / drawn chart / scanning-frame construction with live internal parts',
    avoid: 'boxy static cards, heavy serif type, dead motionless backgrounds',
  },
};

/**
 * Pick the motion signature for a scene from its cinematic direction.
 * Deterministic — same direction always yields the same signature.
 * @param {{energy?:string, mood?:string, isHook?:boolean, isClimax?:boolean}} direction
 */
export function motionSignature(direction = {}) {
  const { energy, mood, isHook, isClimax } = direction;
  if (isHook) return SIGNATURES['maximalist-impact'];                              // open at max power
  if (isClimax) return energy === 'high' ? SIGNATURES['maximalist-impact'] : SIGNATURES['shadow-cut'];
  if (energy === 'high') return SIGNATURES['maximalist-impact'];
  if (energy === 'dramatic') return SIGNATURES['shadow-cut'];
  if (energy === 'low') return SIGNATURES['swiss-precision'];
  if (mood === 'cinematic') return SIGNATURES['velvet-glide'];
  return SIGNATURES['data-drift'];                                                 // steady/other → living HUD
}

/** Render the signature as a compact prompt block. */
export function signatureBlock(sig) {
  return `MOTION SIGNATURE for this scene — "${sig.name}" (${sig.feel}):
- Ease / feel: ${sig.ease}
- Typography: ${sig.type}
- Hero treatment: ${sig.hero}
- Avoid: ${sig.avoid}
Let this signature shape THIS scene's personality so adjacent scenes never feel identical — palette and fonts stay LOCKED to the style guide.`;
}
