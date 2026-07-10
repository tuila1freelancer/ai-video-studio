# 3-Way Gap Analysis — @TuiLa1Freelancer channel (standard) · AI VIDEO Tool (reference) · AI Video Studio (current)

> Inputs: [quality-bar.md](quality-bar.md) (channel standard), [reference-app-analysis.md](reference-app-analysis.md) (competitor app), current codebase map. The upgrade list is ordered by impact on output video quality.

## 1. Comparison table across the 5 stages

### Stage 1 — Script

| | Channel (standard) | Reference app | Current app |
|---|---|---|---|
| Hook | Cold-open pain→promise within 35–60s, promise includes a number | Generic "make the opening engaging" instruction | Outline has "hook 2-3 sentences that spark curiosity" — no pain→promise formula yet |
| Structure | Numbered chapters, spoken number = displayed number; mid-video CTA at ~50%; comment bait at the end | Structure guide by length | 2-stage outline→chapter (≥180s); **no mid-video CTA, no comment bait** |
| Word count | ~260–280 syllables/minute, scenes of 6–12s | Words-per-scene table {5s:24, 6:29, 7:34, 8:38, 10:48} + safety margin ±3-4 words + instruction "TTS reads faster — write ENOUGH words" | `wordsPerScene` estimated at 2.6 words/s, no safety margin, no instruction → risk of scenes falling short |
| Long-video continuity | — | Batch of 25 scenes + summary of the previous 3 scenes | Chapters written sequentially but **the previous chapter's dialogue is not visible** → risk of repeating ideas |
| Language | vi (+ en video) | `outputLanguage` multilingual + wordsPerSecond/lang | **No parameter** — prompt leans toward Vietnamese |

### Stage 2 — Per-scene visuals

| | Channel (standard) | Reference app | Current app |
|---|---|---|---|
| Scene direction | Each scene has 1 focal element, 7 layout patterns, 12 scene types | **B2 generates `[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[TEXT STYLE]/[MOOD]` for EACH scene** | Short video: brief `[MAIN OBJECT]/[ON-SCREEN TEXT]/[MOTION]/[MOOD]`; **long video (≥180s): `visualPrompt = voice.slice(0,90)` — NO real direction** ← critical gap |
| Style guide | Semantic palette (cyan=AI, pink=risk, green=correct, yellow=money), HUD language, mono kicker | 7 sections: locked colors + font size px + Vietnamese diacritics rules + text-effect CSS + SVG icons + ambient + **CONCEPT→VISUAL MAPPING** | Guide only has palette/fonts/motif/treatment/personality — **missing concept-map, text-effects, semantic colors, HUD vocabulary** |
| Codegen | — | Single-file HTML GSAP, zone layout px, visual callback (last beat echoes the first beat +25%) | CODEGEN_SYSTEM is already very good (real beats, FX vocab, contract) — missing visual callback, semantic color, layout taxonomy |
| Validation | — | Static AutoFix | **2-tier lint + renderValidate (clearly superior — KEEP)** |

### Stage 3 — Cross-video consistency

| | Channel | Reference app | Current app |
|---|---|---|---|
| Mechanism | Palette + motion hard-locked across the whole video | Shared style_guide + enforced PALETTE_LOCK + 8 mood presets + visual callback | Guide embedded in every prompt + theme harness outside the LLM (strong) — BUT: **fallback template scenes use the classic theme ≠ guide**; **title card/intro/outro/thumbnail hardcode blue `#1e3a8a`, ignoring the guide**; chapter-break does not receive the guide |

### Stage 4 — Voice

| | Channel | Reference app | Current app |
|---|---|---|---|
| Voice | 1 dominant voice across the whole video, consistent | LarVoice single voice, pad silence 650ms/400ms at the end of each scene | Good per-lang default; **fallback chain edge→say can CHANGE THE VOICE mid-video when a single scene fails**; no silence padding; **no per-scene loudnorm** (only whole-video loudnorm at B7) |

### Stage 5 — Retry / QC

| | Reference app | Current app |
|---|---|---|
| LLM | Multiple rotating keys, 6 attempts/key linear backoff, classifies 401/403/quota to drop the key | 1 key, withRetry ×2-3 — **no key rotation, no model fallback, no error classification** |
| Scene render | Validate concat | ffprobe per mp4 + re-render + deferred pass (superior) |
| Final QC | Duration check | Duration check — **both are missing: black-frame, audio-silence, A/V sync** |
| Music/SFX | AI music plan: BGM + ~20 whoosh/glitch SFX placed at exact section-transition timestamps | Steady BGM + fade — **no scene-transition SFX** |

## 2. Upgrade list (impact-first)

| # | Task | Impact | Main file |
|---|---|---|---|
| **U1** | **Per-scene Visual Direction**: generate cinematic direction `[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]` + scene type (taxonomy S1-S12) for EACH scene in both script branches (short + long ≥180s); a separate pass per batch to avoid bloating the script prompt | ★★★★★ | `src/providers/llm.js`, new: `src/pipeline/direction.js` |
| **U2** | **Style Guide v2**: extend the guide schema (semanticColors, conceptMap, textEffects, hud{kickers, statusTexts}, sceneRules); new preset **"TuiLa1 HUD Cyber"** matching the channel signature (bg #0A0E1A, cyan #22D3EE / magenta #FF2E88 / purple #8B5CF6 / green #34D399 / yellow #FBBF24 semantic); upgrade `generateStyleGuide` to produce all sections | ★★★★★ | `src/hyperframe/styleguide.js`, `src/animation/templates/hyperframe.js` |
| **U3** | **CODEGEN v2**: embed guide v2 (concept-map + semantic colors + HUD vocab) into the prompt; add visual-callback (climax scene echoes the hook motif); layout taxonomy hints based on direction; keep the contract + validate unchanged | ★★★★☆ | `src/hyperframe/prompt.js` |
| **U4** | **Script v2**: pain→promise hook formula (promise includes a number); mid-video CTA + comment bait at the end; words-per-scene table by seconds + safety margin + instruction "write ENOUGH words"; later chapters see a summary of previous chapters; `outputLanguage` config | ★★★★☆ | `src/providers/llm.js` |
| **U5** | **Full consistency**: title card / cta-outro / chapter-break / thumbnail / poster receive the guide (drop the hardcoded #1e3a8a); HyperFrame fallback scenes use `themeFromGuide` instead of the classic theme | ★★★★☆ | `src/pipeline/visuals.js`, `src/pipeline/runner.js`, `src/animation/index.js` |
| **U6** | **Voice v2**: per-scene loudnorm (`loudnorm I=-16` right after TTS); pad silence 650ms vi / 400ms en; **voice-lock**: retry with the same voice ×3 before falling back, mark any scene that had to switch voice as `voice_fallback` + auto re-TTS at the end of the pipeline once the provider recovers; never render a silent scene (empty audio = hard error, retry) | ★★★★☆ | `src/providers/tts.js`, `src/pipeline/runner.js` |
| **U7** | **Final quality gate (B8)**: after concat — ffprobe per scene + final video: black-frame detect (`blackdetect`), audio silence detect (`silencedetect` > 2.5s), A/V duration mismatch >300ms/scene, total duration ±5% of the script; on fail → re-render exactly the broken scene then re-stitch; save the QC report to `qc_report.json` | ★★★★☆ | new: `src/pipeline/qc.js`, `src/pipeline/runner.js` |
| **U8** | **LLM retry v2**: multiple rotating API keys; error classification (401/403/quota → drop key; transient → backoff); model fallback (`llm.modelFallback`); keep the existing withRetry above it | ★★★☆☆ | `src/providers/llm.js` (`chatRaw`) |
| **U9** | **Scene-transition SFX**: whoosh/riser at chapter-break + climax (using the available offline SFX library), volume 0.7-0.8, placed at real timestamps | ★★★☆☆ | `src/pipeline/render.js` or runner B7 |
| **U10** | Whisper retry ×2; metadata/thumbnail retry ×2 (currently swallowing errors silently) | ★★☆☆☆ | `src/providers/subtitle.js`, `runner.js` |

## 3. Decisions for the M1–M10 conflicts in quality-bar (applied as defaults, user can change via config)

- M1 subtitles: **karaoke on** by default (the app already has it, the channel's newer videos use it), color follows the guide accent.
- M2 watermark: **top-right** (3/4 of the video + avoiding the subtitle area).
- M3 bottom bar: **real progress bar** (the app already has a progress bar — keep it).
- M4 scene pacing: by video length (long → 8-14s, short → 5-10s) — mapped to the existing `sceneDuration` config.
- M5 form of address: "mình – các bạn" (fed into the script v2 prompt).
- M6 accent: hero scene locks 1 accent; list/grid scenes rotate color by index (fed into sceneRules of guide v2).
- M7 punch-scene on a light background: not applied by default (light backgrounds are forbidden in the TuiLa1 preset).
- M8 icons: line-art stroke (using the existing offline icon set), 3D glossy deferred for later.
- M10 color tokens: cyan `#22D3EE`, green `#34D399` (standardized in the preset).
