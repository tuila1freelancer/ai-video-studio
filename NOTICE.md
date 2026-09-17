# NOTICE

This product includes work adapted from third-party software. The notices below are licence
obligations and must travel with the distribution.

---

## HyperFrames — Apache License 2.0

> **This section is a licence obligation, not documentation.** Parts of the render doctrine are
> adapted from [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), Apache License
> 2.0, which requires the attribution notice to travel with the work. **Do not delete it.** If this
> file is ever split, this section moves with the code it covers.

Source: <https://github.com/heygen-com/hyperframes> (Apache License 2.0). Upstream paths cited below
refer to that repository, not this one. What is adapted is **craft knowledge** — rules, doctrine and
checks — never the upstream engine.

**Why it maps.** HyperFrames renders the same way this app does: a paused, seekable GSAP timeline
where a frame is a pure function of time, captured by headless Chrome and muxed by FFmpeg. Their 4K
path supersamples via `devicePixelRatio`; ours uses a logical canvas plus body zoom — equivalent
architectures.

**What was adapted**

| Upstream | Adapted into |
|---|---|
| `skills/faceless-explainer/references/motion-language.md` | the motion doctrine in the codegen prompt: a motion **verb** per element, entry → reveal → hold → exit, no decorative movement |
| `skills/faceless-explainer/references/cut-catalog.md` | the cut and transition vocabulary behind `planTransitions` |
| `skills/hyperframes-creative/references/beat-direction.md` | beat-anchored choreography — one keyword enters on its word, holds, exits before the next |
| `skills/hyperframes-animation/blueprints-index.md` | the 15 time-coded shot templates tied to narrative roles, adopted as `HF_LAYOUTS` in `src/pipeline/direction.js` |
| `packages/lint/src/rules/` | the static lint rules in `src/hyperframe/lint.js` |
| `packages/cli/src/utils/layoutAudit.ts` | the runtime layout audit in `src/hyperframe/validate.js` |
| `packages/core/src/text/fitTextFontSize.ts` | the text-fitting pass in `src/animation/harness/runtime-typeset.js` |

**Blueprints** (`skills/hyperframes-animation/blueprints-index.md`) — 15 time-coded shot templates,
each tied to narrative roles (Hook, Problem, Product_Intro, Key_Feature, Benefits, Social_Proof,
CTA, Brand_Outro). The ones adopted as layouts, and referenced by name from
`src/pipeline/direction.js`:

- **`kinetic-type-beats`** — the words *are* the motion (token swaps, statement builds); the
  workhorse, covering six roles.
- **`ticker-takeover`** — typed lead-in and a cycling accent word, then the hero crashes in and
  physically shoves the text aside (hook / outro).
- **`overwhelm-surround`** — overwhelm by accumulation; elements close in from every side
  (problem and pain scenes).
- **`spatial-pan-stations`** — labelled stations on one oversized canvas, traversed by a single
  virtual camera (timelines, processes, long videos).
- **`titlecard-reveal`** — the calm breather: one restrained move, then a still hold. *"Low motion
  is the payload, not a deficiency."*

**Determinism rules restated in our codegen prompt** — no wall-clock time, no `setTimeout` or
`requestAnimationFrame`, no event listeners, no network; everything on the paused root timeline, so
that frame = f(time) holds under out-of-order seeking. These are enforced mechanically by
`src/hyperframe/lint.js` rather than requested in prose.

---

