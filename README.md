# 🎬 AI Video Studio

A **macOS** desktop app that automatically generates videos from a **topic / JSON script / article link** — any length you want
(from 30 seconds to 30+ minutes). An optimized rebuild of `AI VIDEO Tool.app`: it drops the heavy Chromium UI shell
in favor of a **native WKWebView**; a lightweight **Node.js 22** backend; runs **fully offline**.

> Pipeline: **B2 Script → B3+4 TTS+Subtitles → B5 Scene build → B6 Render → B7 Concat & Mix**.

---

## ✨ Features

- **One tap, nothing else to do**: on the Home screen enter a topic → **✨ Tạo video tự động** → out comes a complete MP4 video.
- 💎 **"Studio Pro" interface** — a multi-layered dark design system (glass + hairline + spring motion), **Lexend** font (Vietnamese subset, self-hosted), stroke SVG icons throughout the app, a transparent titlebar in Linear/Arc style on the native build, a **⌘K command palette** (navigate / create video / apply preset / open recent projects, searchable without typing diacritics), custom dialogs + toasts (no more system confirm/prompt), skeleton loading, View Transitions when switching pages.
- ⚡ **60fps frontend with 200+ scene projects** — the scene grid uses event delegation (4 listeners for the whole grid), WS updates batched over 80ms + per-card patching (no rebuild), video previews only attach `src` on hover, images lazy-load, `content-visibility` skips off-screen layout/paint; first render of 191 scenes ~48ms. The code is split into 20+ native ESM modules (`public/js/{ui,views,features}`), no bundler.
- 🚀 **HYPERFRAME MODE** — the AI **art-directs graphics individually for every scene, following the narration word by word**: the server extracts **beats** from real word-timestamps (Whisper) → an LLM writes `{css, html, script}` GSAP for each scene (keywords/figures/icons appear exactly when the voice mentions them, then withdraw before the next beat — the opening frame has only ambient); the **video Style** is locked throughout (7 presets: **TuiLa1 HUD Cyber** (distilled from the reference channel — semantic colors, concept→visual map, HUD kickers) · Chrome Kinetic · Neon Tech · Minimal Editorial · Glass Aurora · Bold Poster · Cinematic Dark, or let the AI design its own from a description); a library of ~125 offline icons + 20+ professional FX (carrier-in, chrome sweep, whip-out, glitch, counter-roll, beam sweep, parallax, camera push…). Enable it under Output config → Image mode → ✨ HyperFrame.
  - 🎬 **Art-director pass**: before writing code, the AI writes **cinematic visual direction for EVERY scene** ([LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]) in batches with a global view — layouts vary between adjacent scenes, the closing scene **echoes the hook scene's motif** (visual rhyme), and concepts matching the concept-map use the style's exact visual formula. Hours-long videos now get real direction for every scene (previously only short videos did).
  - 🛡 **Two-tier error-proof validation**: each AI-written scene is **actually rendered and then inspected automatically** (runtime errors, frame overflow, subtitle overlap, empty scene ending, fabricated/wrong-language text) → fed back to the AI to fix; only passing scenes are accepted, otherwise it falls back to a backup template — the pipeline **never dies** and stays **deterministic frame by frame**. The output format is **fenced (not JSON)** so weaker models don't break the code.
  - 🎛 **AI tuning per video**: **Motion density** (Minimal/Balanced/Dense) · **Creative direction** (notes applied to every scene) · **Separate AI model for HyperFrame** (use a dedicated strong model for the scene-build step — the single biggest quality lever). On-screen text is always taken verbatim from the narration, in the correct language.
- 🎬 **ANIMATION MODE (default)** — **pure-code motion-graphics** videos (HTML/CSS/JS rendered frame by frame, smooth at 30/60fps) in a neon-tech style: kinetic-typography glow, HUD labels, line-art icons, glass cards, timelines, mindmaps, chat demos, terminal scans… **20 templates** auto-selected per scene content + integrated karaoke captions + progress bar + watermark. 3 themes (Neon Tech / Gradient Soft / Minimal Light), 1080p or 4K.
- ✨ **GSAP 3.13 deeply integrated (all premium plugins, free)** — every template gets high-end effects *while staying deterministic frame by frame*: 3D per-character flying text (SplitText), self-drawing icon strokes (DrawSVG), counters + gauge arcs, hacker-style decoding text (ScrambleText), bouncing falling stars, physics confetti (Physics2D), 3D perspective cards, racing bars, CustomWiggle shakes. 6 new showcase templates: `split-cascade` · `counter-stat` · `orbit-3d` · `physics-burst` · `draw-diagram` · `bar-race`.
- 🩹 **Self-healing, no babysitting needed** — every step auto-retries with backoff; the LLM supports **multiple rotating API keys** (paste several keys separated by commas/newlines — a key that hits its quota is skipped automatically) + a **fallback model** (`modelFallback`); a failed scene render auto-switches to a backup template and retries; after render there's a step that **inspects each mp4 file** (ffprobe: duration + both streams present + A/V matches the voice — a silent scene is an error and is never shipped) and re-renders broken scenes; a pipeline that hits an unexpected error auto-resumes after 8 seconds; if the server crashes → reopen and hit Resume to continue. The UI clearly shows "🩹 đang tự thử lại".
- 🔬 **Final quality gate (B8)** — the assembled video is **actually decoded and inspected**: black frames (blackdetect), silence gaps >3s (silencedetect), missing streams, duration off by >8%; errors traceable to a specific scene **auto-re-render that exact scene and re-concat** (one cycle); results are saved to `qc_report.json` in the project folder — it never reports "done" while unrecorded errors remain. Disable with `qcGate:false`.
- 🎙️ **Consistent voice across the video** — the chosen voice is "locked": a TTS failure retries the same voice 3 times before falling back, and any scene that had to use the fallback voice is **auto-retried with the primary voice** at the end of the step; every scene passes through **per-scene EBU R128 loudnorm** (uniform volume regardless of provider) + a 650ms (vi) / 400ms (en) breath-pad at the end of each scene.
- 🔊 **Automatic chapter-transition SFX** — an offline-synthesized whoosh (deterministic) placed at the exact timestamp of each chapter change, mixed under the voice. Disable with `autoSfx:false`.
- 📖 **Two-stage scripting for long videos** (when an LLM is plugged in): a hook following the **pain → promise with a number** formula, a chapter outline, a **mid-video CTA** + an end CTA with a **comment-baiting question**; each chapter sees the previous chapter's ending so ideas don't repeat; the word count per scene is **computed from each language's reading speed** (vi ≈ 4.4 words/s) with a safety margin — scenes no longer come up short on duration; offline, it still auto-splits chapters from paragraphs + adds chapter transitions + an end-of-video CTA.
- 🖼️ **Image mode (optional)** — cinematic AI images per scene (Pollinations, free, no key) + Ken Burns.
- **Full automation (on by default)**: 🎙️ **neural voice auto-matched to each scene's language** (vi/en/ja/ko/zh/ru — never reads the wrong language) · karaoke subtitles · 🎵 automatic background music · 🎬 intro + outro · volume normalization + fade · 📊 metadata **including YouTube Chapters** · a nice thumbnail.
- 🎙️ **Multi-provider voice library**: Edge Neural (322 voices, free) · macOS say (offline) · **Vbee** (Northern/Central/Southern Vietnamese voices) · **LarVoice** (official larvoice.com API — Bearer key created at `larvoice.com/app/api`, ~300 vi/en/zh/ja/ko voices, **0-credit previews** from bundled samples) · ElevenLabs · OpenAI — search/filter by language + gender, **▶ preview every voice** (cached), ⭐ pin, set a **default voice per language**; each provider has its own config form + a 🔌 Test-connection button. API keys are masked with `••` at every exit point.
- 📺 **Multi-channel (Channels)**: each channel gets its own folder (`~/Movies/AI Video Studio/<channel>/` — projects, library, output, channel.json) and its own config (voice, theme, watermark, aspect ratio…) that is inherited into every new video; switch channels with one tap in the sidebar; finished videos land in the channel's `output/`.
- 🏷 **Per-channel Brand Kit**: logo + channel name + stickers auto-inserted into **each scene** — a 🧠 *smart* mode that automatically avoids template content & subtitle areas, or a 📌 fixed **free drag-and-drop** placement in the Brand Editor (background = a real scene from the channel); 3 logo styles (plain/glass/glow), 3 channel-name styles (text/pill/neon underline); the channel name auto-fills the opening scene label + outro CTA "Đăng ký <channel>". Layered config: channel → default preset → panel (a single merge point, `src/core/config.js`).
- 🎛 **Per-channel Presets**: save an entire panel config as a named preset (e.g. "Short 4K", "Long 16:9"), set a ⭐ default — new videos on the channel (including those triggered via API/batch) pick it up automatically. AI settings (LLM/voice/subtitles) **override per channel individually**, API keys masked with `••` at every exit point.
- 💬 **10 ready-made beautiful subtitle presets** (click to pick from the gallery, rendered with real fonts): Karaoke Vàng, Impact Đậm, Neon Rực, Bản Tin (box), Điện Ảnh, Tối Giản, Pop Tròn, Thể Thao, Punch, Terminal — 8 offline vendor Vietnamese fonts (rebuild with `npm run fonts:build`) + auto-switch to a system font for Japanese/Korean/Chinese; applied to both animation captions and image-mode burned-in subtitles (bundled TTF for libass).
- 👁️ **Live per-scene preview** — click ▶ on a scene card: the animation actually plays with sound right inside the app, no render needed.
- ✏️ **Edit text on a scene** (heading/sub/label/props) + change a scene's template + regenerate the preview instantly.
- 📦 **Batch run** — paste multiple topics (one video per line), the app processes them one by one overnight.
- 📑 **Export a whole-video .SRT file** (on the correct timeline) to upload YouTube subtitles.
- **Flexible input**: text · JSON script · article link (auto-fetches content + images).
- **Aspect ratios**: 9:16 (TikTok/Reels), 16:9 (YouTube), 1:1, 4:5.
- **Long videos, no problem**: processed scene by scene + concatenated incrementally → RAM doesn't grow with length.
- **Fully customizable karaoke subtitles**: font, size, weight, color (palette + custom), position.
- **Scene grid**: view/regenerate voice · regenerate scene · re-render individual scenes.
- **Library** for Brand / BGM / SFX, **Brand Asset Gen**, **Edit Video** (trim), **Metadata** (title/desc/hashtag), **SRT editor**.
- **Real-time progress** over WebSocket, **stop / resume**, **parallel render**.
- **Pluggable AI, with an offline fallback**:
  | Step | Online (plug in a key) | Offline default |
  |------|------------------|------------------|
  | Script / Metadata | OpenAI-compatible (GPT/Gemini/Claude…) | Smart sentence splitting |
  | Narration (TTS) | OpenAI / ElevenLabs | **macOS `say`** (has a Vietnamese voice) |
  | Subtitles | — | **estimate** (accurate text from the script) or **whisper.cpp** |
  | Scene build | (AI images) | **HTML poster** (headless Chrome) |
  | Image search | Tavily | Gradient placeholder |
  | Concat/Render | — | **ffmpeg** (with libass) |

---

## 🚀 Run

**Option 1 — Browser (simplest):**
```bash
./run.command            # or double-click in Finder
```
Opens the browser at `http://127.0.0.1:8123`.

**Option 2 — Native macOS app (WKWebView):**
```bash
npm run shell:build      # build "AI Video Studio.app"
open "AI Video Studio.app"
```
The app auto-starts the backend, then shows the native window.

**Dev:**
```bash
npm install              # needs Node 22 (e.g.: /opt/homebrew/opt/node@22/bin)
npm start                # server picks a port, prints "AVS_READY <url>"
npm run test:e2e         # end-to-end video-creation test
npm run fonts:build:ui   # re-download Lexend/JetBrains Mono for the UI (public/fonts) — does NOT touch scene fonts
npm run fonts:build      # ⚠ fonts for SCENE render (vendor/fonts) — changing this affects video byte-compat
npm run icon:build       # render shell/icon.svg → shell/AppIcon.icns (headless Chrome + sips + iconutil)
```

---

## 🧱 Architecture

```
AI Video Studio.app   ← Swift shell + WKWebView (shell/main.swift)
   └─ spawn Node 22 backend (src/server.js) → wait for /api/health → load localhost
src/
  server.js            Express + WebSocket + static SPA
  config/paths.js      resolve ffmpeg/whisper/chrome/say (vendor → app root → system)
  core/config.js       config layering (channel → preset → request) + AI settings + mask secret
  db/
    connection.js        handle + schema + migrations (better-sqlite3)
    repositories/        queries by domain: settings · projects · scenes · channels · catalogs
    index.js             barrel: re-export every repo + seed/backfill + export default db
  api/
    routes.js            REST API — thin handlers: validate → call service → JSON
    services/            business logic: file-access (allowlist) · voice-preview · voice-catalog · batch
  pipeline/            B2→B8 runner · render (ffmpeg) · visuals (poster) · srt (ASS karaoke) · qc (gate)
  styleguide/          🎨 SHARED style contract (breaks the animation↔hyperframe loop):
    guide.js             schema + normalizeGuide + HF_DEFAULT_GUIDE + SAMPLE_SPEC (pure)
    theme.js             themeFromGuide (guide → render theme)
    presets.js           7 presets (chrome-kinetic, tuila1-hud-cyber…) + resolveGuide
    generate.js          generateStyleGuide (AI designs a guide from a description)
  animation/           🎬 deterministic motion-graphics engine:
    harness.js           self-contained scene page + runtime __seek(t) (pause & seek CSS animation + scrub GSAP timeline)
    gsap.js              bundle GSAP 3.13 + 12 premium plugins (vendor, offline, inlined)
    renderer.js          frame-loop Puppeteer → JPEG → ffmpeg image2pipe → mp4 (flat RAM)
    templates/           21 neon-tech templates, one file each + _shared.js (GSAP FX runtime)
    planner.js           picks template + props by content (VN heuristic + 1 LLM call)
    themes.js            design tokens (neon-tech / gradient-soft / minimal-light)
  hyperframe/          ✨ LLM-writes-GSAP system: codegen · validate · prompt · beats · icons · lint
  providers/           llm · tts · subtitle · imagesearch · fetchlink (all with fallbacks)
  media/               ffmpeg · say · whisper · puppeteer (headless Chrome)
public/                "Studio Pro" SPA: index.html + css/(app,fonts).css + fonts/*.woff2 (Lexend UI)
  js/                  ESM modules: main.js · state.js · api.js
    ui/                  dom · icons (SVG set) · toast · dialog · modals · palette (⌘K)
    views/               nav · home · studio · scenes (grid+patch) · progress · config · library…
    features/            settings · voicepicker · channels · brandkit · srt · batch
vendor/ffmpeg/         static ffmpeg/ffprobe (with libass — the Homebrew build lacks it)
vendor/fonts/          fonts.css for SCENE render (data-URI, offline — don't confuse with UI fonts)
vendor/gsap/           GSAP 3.13.0 + SplitText/DrawSVG/MorphSVG/MotionPath/Physics2D/ScrambleText/CustomEase…
```

**System dependencies** (auto-detected, preferring `vendor/`, then the app root, then system):
ffmpeg (libass), whisper.cpp + the `ggml-small.bin` model, Chrome for Testing, `say` (macOS).

---

## ⚙️ AI configuration (optional)

Go to **⚙️ AI Setting** in the app to plug in:
- **LLM**: Base URL + API Key + model (OpenAI-compatible — cheap proxies work).
- **TTS**: choose `say` (offline) / OpenAI / ElevenLabs + voice.
- **Subtitles**: `estimate` (recommended — text is 100% accurate from the script) or `whisper`.

With nothing plugged in it still runs fully using the macOS voice + ffmpeg.

---

## 📂 Data

All projects, media, and the DB live in `data/` (gitignored). Each project has its own folder:
`data/projects/<id>/{audio,srt,html,render,output}`.
