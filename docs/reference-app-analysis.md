# Reference app teardown: AI VIDEO Tool (`com.videopipeline.desktop`)

> Analysis sources: `dist-backend/server.bundle.cjs` (1.9MB, reverse-engineered), `~/Library/Application Support/VideoPipeline/` (pipeline.db, real sessions, settings), sample session `sess_1782526195852` (90 scenes, video "12 thói quen nhỏ giúp người mới dùng AI", exactly the kind of video published on the @TuiLa1Freelancer channel).

## 1. Pipeline diagram

```
topic + styleId + duration
  │
  ├─ B0. STYLE GUIDE (AI, once per style, stored in DB video_styles)
  │      7 sections: hard-locked COLORS → FONT SIZE px by role → VIETNAMESE rules (.txt)
  │      → TEXT EFFECT PRESETS (verbatim CSS) → DOMAIN ICONS (pre-inlined SVG)
  │      → AMBIENT SUGGESTIONS → CONCEPT MAPPING → VISUAL by domain
  │
  ├─ B1. PLAN: sceneCount = ceil(duration/sceneDur[5..8s]); words/scene per table {5:24, 6:29, 7:34, 8:38, 10:48}
  │
  ├─ B2. SCRIPT (AI, JSON): each scene { stt, voice, visual, assets }
  │      • voice: safe range ±(3..4) words around the target, with the note "TTS reads faster than you'd think — write ENOUGH words"
  │      • visual: structured CINEMATIC director prompt (see §3)
  │      • >30 scenes → split into batches of ~25, passing a summary of the previous 3 scenes to keep continuity
  │      • validate the correct scene count; on schema errors → regenerate up to 2 times
  │      • includes thumbnail {title, prompt}
  │
  ├─ B3. per-scene, running in parallel (concurrency 8):
  │      TTS (LarVoice by default, pad silence 650ms vi / 400ms en)
  │      → SRT (aligned_srt from LarVoice or whisper-cli ggml-small, ≤5 words/cue)
  │      → HTML (AI: visual + style guide + palette lock + beat timeline → single-file GSAP)
  │      → Puppeteer captures each frame (CDP beginFrame or screenshot) → ffmpeg h264
  │      → merge audio → burn karaoke ASS + logo
  │
  ├─ B4. CONCAT: xfade=fade:0.5 (video) + acrossfade (audio); validate resolution/audio/duration
  ├─ B5. MUSIC PLAN (AI): 1 BGM volume ~0.1 + ~20 SFX (whoosh/glitch/riser) placed at the exact section-transition timestamps
  └─ B6. THUMBNAIL: static HTML → JPEG
```

LLM model: 5 OpenAI-compatible providers (trollllm/infinity/yescale/shopaikey/custom), high model tier (claude-opus-4-7, gpt-5.5, gemini-3.1-pro). Every prompt is sent as a single `role:user` message, streamed over SSE, with a 5-minute timeout per call.

## 2. Style Lock — the main consistency weapon

Four stacked layers, all expressed as **text within the prompt** (no seed, no reference image):

1. **Shared `style_guide`** (DB `video_styles`): injected verbatim into the HTML prompt of EVERY scene. This is not a vague description but a detailed spec: a list of hex values "only use those in this list", font sizes in px by role (Hero 200-280px / Title 72-96px / Label 32-40px…), verbatim CSS text-effects, pre-written inline SVG icons, and a **CONCEPT MAPPING → VISUAL table** (e.g. "Process/Step-by-step → staggered reveal, NEVER show the entire list at once").

2. **PALETTE_LOCK** (when "Consistent scenes" is enabled), verbatim:
   > ⚠⚠⚠ CHẾ ĐỘ "SCENE NHẤT QUÁN" ĐANG BẬT ⚠⚠⚠ … Body background PHẢI dùng CHÍNH XÁC màu ĐẦU TIÊN trong "BG accent"… Text chính PHẢI dùng CHÍNH XÁC màu ĐẦU TIÊN trong "Primary"… Tất cả scenes trong video này PHẢI có CÙNG background color và CÙNG primary text color.

3. **VISUAL_STYLE_BLOCK**: 8 fixed motion/color presets (Swiss Pulse, Velvet Standard, Deconstructed, Maximalist Type, Data Drift, Soft Signal, Folk Frequency, Shadow Cut) selected by the mood of the scene — same mood → same preset → same easing/typography/transition.

4. **VISUAL CALLBACK**: the closing beat of a scene must reprise one element from the opening beat at scale +25% and stronger glow (a "visual rhyme").

## 3. Scene-direction language (the `scenes.visual` field)

Generated right inside the B2 script prompt — each scene gets one structured passage:

```
[ENVIRONMENT]  background + AT LEAST 3 depth layers (far/mid/near) + atmosphere (particles/fog/bokeh)
[MAIN FOCUS]   main subject (keyword/object/number/icon) + position + scale (dominant/subtle)
[CAMERA]       slow zoom in/out · pan · parallax shift between layers
[MOTION FLOW]  Entry (glitch-in/scale-up/slide) → Idle (floating/drift/pulse) → Exit
[LIGHTING & FX] glow, shadow, light sweep, depth blur
[TEXT STYLE]   bold/minimal/futuristic/kinetic (or None)
[MOOD]         cinematic/epic/clean/premium/dark/energetic
```

Plus the constraint: "⛔ Do NOT describe a static layout, don't just say 'display text'… 🎯 the scene must be like an Apple keynote animation. At most 2-3 main animated elements — an over-complex scene = broken HTML."

Real example from the session (scene 20): `[MAIN FOCUS] Large puzzle pieces assembling into a glowing square… Idle: pieces snap together, each piece showing an icon (User, Tone, Platform)…` — the subject is **a literal visual metaphor of the voiceover** (the setting = assembling a puzzle), not generic flying text.

## 4. Scene-HTML generation prompt (the parts worth learning from)

- GSAP timeline **paused** + `window.__timelines["main"] = tl` — the renderer scrubs frame by frame (like our current harness).
- `DUR = audioDuration/1000` accurate to the millisecond; the progress bar animates itself `width 0→W over DUR`.
- Bans `repeat:-1`, CSS @keyframes, and setTimeout; ambient loops must use `repeat: Math.ceil(DUR/cycle)-1`.
- **VOICE TIMELINE**: each beat comes from the SRT with the rule "Visual enters at beat.from (±200ms). ENTER 350-500ms | HOLD ≥1500ms | EXIT 250-350ms. Last beat = CLIMAX: scale+15%, strong glow, hold to end."
- **Zone layout**: specific safe-zone px per aspect ratio, with the lower-third being the subtitle area.
- **Vietnamese rules**: every `class="txt"` text (`line-height:1.5; overflow:visible; padding-top:0.15em`) plus a CSS block forcing `overflow:visible!important` on every `[class*=title/label/hero/stat…]` — to prevent clipping of diacritics like ắ/ế/ổ.
- **Brand mascot**: a set of character PNGs by pose/emotion (`character … smiling brightly.png`) in `brand-specificities/`; the LLM picks the image matching the scene's emotion and embeds it directly into the HTML.
- Target code 300-650 lines/scene; in the actual session: ~200 lines, 7-17KB/file, GSAP only (particles hand-drawn in plain JS).

## 5. Retry / self-recovery

| Stage | Mechanism |
|---|---|
| LLM call | Rotate across multiple API keys; each key retries 6 times with linear backoff 2s·n; 401/403/quota errors → drop the key and move to the next; only throw when out of keys |
| JSON parse | Strip fences + a "patcher" for truncated JSON (count brackets, auto-close missing strings/brackets) |
| Script | Validate the schema of each scene (stt/voice/visual); wrong scene count → regenerate up to 2 times with the reminder "You MUST return exactly N scenes" |
| HTML | AutoFix + validate after generation |
| TTS | LarVoice 3 tries/key + rotate keys when credit runs out; poll the job 90×3s; ElevenLabs 3 tries with 2s backoff |
| Concat | Validate resolution/audio-stream/duration of each clip; on mismatch → request a re-render of the failing scene |

## 6. Strengths to emulate vs weaknesses to surpass

**Emulate (bring into the current app):**
1. The "thick" 7-section style guide — especially **CONCEPT MAPPING → VISUAL** and the verbatim **TEXT EFFECT PRESETS** CSS.
2. The `[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]` director language generated at B2 for EVERY scene — our app currently only has a heuristic + `voice.slice(0,90)` for long videos.
3. Enforced PALETTE_LOCK + visual callback (visual rhyme).
4. The words/scene-by-seconds table plus the note "TTS reads faster — write ENOUGH words" (to prevent under-filled scenes).
5. Batching >30 scenes with a summary of the previous 3 scenes.
6. **AI music plan**: whoosh/glitch SFX placed at the exact section-transition timestamps (our app so far only has a uniform BGM).
7. Brand mascot by pose/emotion.
8. Rotation across multiple API keys + classifying auth/quota errors (drop the key) vs transient errors (retry).
9. Padding silence at the end of each scene's audio (650ms vi / 400ms en) — a breathing beat between scenes.

**Its weaknesses (where we're already ahead — hold the line):**
1. Rendering is NOT deterministic: CDN + Google Fonts (network-dependent), no seeded PRNG — our app is fully offline + deterministic frame by frame.
2. No dynamic real-render validation (our renderValidate catches frame overflow / subtitle overlap / fabricated text / empty scene endings — theirs only does static AutoFix).
3. No beats from real word-timestamps at code-GENERATION time (they feed the SRT into the prompt, but we extract beats more precisely via `extractBeats`).
4. A single user message, no system prompt, no multi-turn error correction — our defect→fix re-prompt loop is much stronger.
5. No offline fallback: if the LLM dies, the pipeline dies (we have a heuristic template + offline script).
6. No per-scene loudnorm (same as us — both lack it).

## 7. Output technical specs (real session)

- Scene video: h264 1920×1080@30fps yuvj420p, audio aac 24kHz mono; scene ~8-12s.
- Burned karaoke ASS subtitles: Be Vietnam Pro size 80 (16:9 ×0.9), chunks ≤5 words, `\fad(60,80)\blur1`.
- Logo overlay per `logoPosition` per-aspect (16:9: x95% y7% w110px).
- final.mp4 ~15.5 minutes for a 12-minute config (in practice longer, roughly +29%).
