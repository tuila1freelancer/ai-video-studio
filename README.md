# 🎬 AI Video Studio

A **macOS** desktop app that automatically generates videos from a **topic / detailed script / scenes JSON / article link** — any length you want (from 30 seconds to 30+ minutes). An optimized rebuild of `AI VIDEO Tool.app`: it drops the heavy Chromium UI shell in favor of a **native WKWebView**; a lightweight **Node.js 22** backend; runs **fully offline**.

> Pipeline: **B2 Script → b2.5 Editorial gate → b2.75 Duration fit → B5 Scene build → (scene gate) → B3+4 TTS+Subtitles → B6 Render → (review gate) → B7 Concat & Master → B8 QC gate → Metadata → B9 Publish**.
> Scenes-first: visuals are built against an estimated timing seed BEFORE any TTS credit is spent, then time-warped onto the real voice.

---

## ✨ Features

- **One tap, nothing else to do**: on the Home screen enter a topic → **✨ Tạo video tự động** → out comes a complete MP4 video.

### 📜 Master Script Engine (B2)

ONE master prompt turns **every input shape** into the same canonical factory-format scenes JSON
`{thumbnail{title,prompt}, scenes[{stt,voice,visual,assets}]}` — per-scene `visual` is a full 8-bracket
motion-graphics brief (`[ENVIRONMENT]…[MOOD]`) that HyperFrame codegen consumes directly:

- **Topic** → plan-then-write (throughline → spine → scenes) + a value-architecture doctrine (every scene teaches one concrete thing; no tag-question filler, no invented statistics).
- **Detailed owner script** (≥80 words) → **light polish only**: keep ≥90% of the wording and every idea in order, fix broken sentences, smooth joins, add missing CTAs — enforced by the `POLISH_FLOOR` gate; duration follows the content, never the other way around.
- **Pasted scenes JSON** → validated + repaired import, **zero LLM calls**.
- **Article link** → the article is fetched and handed over as research material (**rewrite, never copy** — a new script in the channel's voice, grounded in the article's facts).

Reliability: a defect-driven validator (`META_LEAK` / `NOT_SPEAKABLE` / `BRACKETS` / `MONOTONY` / `COUNT` / `WORD_BUDGET` / `POLISH_FLOOR`) drives one re-ask, then a deterministic repair — a CTA-note/hashtag line can never reach TTS. Long videos (>30 scenes) generate in **batches of 25 with rolling context**; a detailed script is partitioned **word-balanced** so no sentence is ever lost or repeated at a batch boundary, and a batch whose reply overflows the model's output window automatically **splits into smaller calls** instead of failing the run. B2 writes a canonical `scenes.json` artifact per project (re-export any time via `GET /projects/:id/scenes-json` or the Studio toolbar).

### 🆕 v3 upgrade highlights

- 🌐 **Video language is a real setting** — pick it per video, or save it on the channel and every video of that channel inherits it (`auto` reads it from your topic). One resolver answers "what language is this video" for the whole pipeline, so the script, the on-screen text, the subtitles, the voice, the thumbnail and the word budget can no longer disagree with each other. The codegen prompt is told the language outright instead of inferring it, and the render validator now **re-asks** when a scene comes back in the wrong language (bounded — after three tries it ships the scene and says so loudly, rather than failing the video).
- 🗄 **Durable production infrastructure** — a persisted **job queue** (survives crashes: queued/batched work continues after a restart), a global **resource governor** (concurrent runs can no longer oversubscribe Chrome+ffmpeg), **versioned DB migrations with auto-backup**, and a **content-hash resume**: edit one scene's script and only THAT scene re-records + re-renders.
- 💸 **Cost meter + budget guardrail** — every LLM/TTS call is metered per video (`GET /api/usage`, live over WS); an optional per-video USD cap automatically downgrades to the free paths (offline script + edge voice) when reached.
- 🎚 **Broadcast audio** — scene voices get measured LINEAR loudness normalization (no pumping), BGM **ducks under the voice** via sidechain compression, and the finished file is **mastered to −16 LUFS / TP −1.5** with the audio-only corrected (video never re-encoded); LUFS/true-peak land in `qc_report.json`.
- 📝 **Forced-alignment subtitles** — captions show the EXACT script words with whisper-timed karaoke (whisper only donates timestamps, biased by the script as its decode prompt); phrase-shaped cue breaks; `85%`/`50.000đ`/dates are expanded for the VOICE only (captions keep the digits) + per-channel pronunciation lexicon; per-scene prosody hints (hook = energetic) on expressive providers.
- ▶ **Rough-cut player + review gate + takes + timeline** — watch the whole video live BEFORE rendering (master clock over live scene pages), approve/reject each scene (the pipeline holds before concat until everything is approved), every voice/visual regen keeps **take history** with one-click rollback, a per-cue **subtitle studio**, and a read-only **timeline** (clips + waveforms + captions + scrubbing playhead).
- 🛑 **Scene gate (opt-in)** — with `config.sceneGate` the pipeline holds right after the storyboard (B5) at a distinct `'scenes'` status; TTS money is only spent after the owner explicitly approves the scenes (`POST /projects/:id/approve-scenes`).
- 🪶 **Editorial gate (b2.5)** — a free deterministic pass flags wrong-language scenes, truncated clauses, word-budget misses, near-duplicate narration, **formulaic tag-question hooks and value-thin scenes**; one bounded LLM rewrite fixes exactly the flagged scenes.
- ⏱ **Duration fit (b2.75)** — total narration is audited against the ordered video length (±12%): over → one bounded LLM tighten pass + a sentence-safe deterministic trim; under → one enrich pass. Auto-duration mode, pasted JSON and detailed owner scripts are never touched (the owner's words are the deliverable).
- 📤 **Distribution** — one-click **YouTube publish** (OAuth loopback, resumable upload, thumbnail; STAGES AS PRIVATE by default), **multi-aspect repurposing** (16:9 ↔ 9:16 with full reflow — voice/captions reused verbatim, zero re-synthesis), SEO **metadata 2.0** (per-platform titles/tags/pinned comment), **A/B thumbnail variants**, and an end-screen "Xem tiếp" cross-promo.
- 🛰 **Content assistant** — trend-based topic suggestions (RSS/Atom feed packs, deduped against everything the channel already made), a **production calendar** (due slots auto-become videos), an ops dashboard, a per-channel **Show Bible** injected into script generation, and a channel-pinned **style guide** (every new video inherits the brand look; palettes are WCAG-locked at save). Assistant proposals never auto-start a paid pipeline — only an explicit owner click does.
- 🧪 **Named regression tests for all 24 protected behaviors** + functional QC/audio/fingerprint/master-script suites (`npm test`, CI on Node 22) — plus a **visual-parity harness** (`scripts/parity/`) that renders the same narrations as the reference app's real sessions and scores an 8-item reference-caliber checklist on the live DOM.
- 💎 **"Studio Pro" interface** — a multi-layered dark design system (glass + hairline + spring motion), **Lexend** font (Vietnamese subset, self-hosted), stroke SVG icons throughout the app, a transparent titlebar in Linear/Arc style on the native build, a **⌘K command palette** (navigate / create video / apply preset / open recent projects, searchable without typing diacritics), custom dialogs + toasts (no more system confirm/prompt), skeleton loading, View Transitions when switching pages.
- ⚡ **60fps frontend with 200+ scene projects** — the scene grid uses event delegation (4 listeners for the whole grid), WS updates batched over 80ms + per-card patching (no rebuild), video previews only attach `src` on hover, images lazy-load, `content-visibility` skips off-screen layout/paint. The code is split into 25+ native ESM modules (`public/js/{ui,views,features}`), no bundler.
- 🚀 **HYPERFRAME MODE** — the AI **art-directs graphics individually for every scene, following the narration word by word**: the server extracts **beats** from real word-timestamps (Whisper) → an LLM writes `{css, html, script}` GSAP for each scene (keywords/figures/icons appear exactly when the voice mentions them); the **video Style** is locked throughout (6 presets: **TuiLa1 HUD Cyber** (distilled from the reference channel — semantic colors, concept→visual map, HUD kickers) · Neon Tech · Minimal Editorial · Glass Aurora · Bold Poster · Cinematic Dark, or let the AI design its own from a description); a library of ~130 offline icons + 25+ professional FX (carrier-in, chrome sweep, whip-out, glitch, counter-roll, beam sweep, parallax, camera push, zoom-through, target-zoom, DOF blur…). This is the app's SINGLE visual mode.
  - 🎬 **Art-director pass**: before writing code, the AI writes **cinematic visual direction for EVERY scene** ([ROLE]/[LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[CHOREOGRAPHY]/[LIGHTING & FX]/[MOOD]) in batches with a global view — 15 layout archetypes, retention roles (hook/problem/insight/step/proof/payoff/cta), a motion VERB per element, the closing scene **echoes the hook scene's motif** (visual rhyme). Scenes that already carry a master-engine 8-bracket visual skip this pass. Master visuals and directions feed codegen **together with the scene's full verbatim narration** (protected behavior P19).
  - 🎞 **Role-driven transitions (default ON)**: scene boundaries get velocity-matched cuts/blends planned from the scenes' roles — 1-2 hero transitions (zoom-through on the reveal, inverse on the payoff), a smooth 0.2s dissolve as connective tissue. `config.transitions:false` restores hard cuts.
  - 🛡 **Structural render validation (advisory, reference-parity — P39)**: each AI-written scene is **actually rendered** and checked. The **structural floor** — the script threw at runtime, or the scene renders blank — is the only thing that re-asks the model (a genuinely broken scene); every layout finding (frame overflow, subtitle-band intrusion, text overlap/clip/occlusion, center-clump) is now an **advisory warning** (logged, never a re-ask), matching the reference app, whose validation is advisory. The fence parser + syntax check + the structural floor still block the actual blank-scene bug at the source.
  - 🚫 **No-fallback quality contract**: codegen runs on the **primary model only** — up to **10 corrective attempts** per scene (validation defects fed back each round), then the run **fails loudly** naming the exact scenes. No fallback model, no heuristic-template substitution: a quiet mediocre scene never ships. Resume retries only the failed scenes.
  - 🎛 **AI tuning per video**: **Motion density** (Minimal/Balanced/Dense) · **Creative direction** (notes applied to every scene) · **Separate AI model for HyperFrame** (use a dedicated strong model for the scene-build step — the single biggest quality lever).
  - ⏲ **Beat-anchored time-warp**: specs are authored against estimated timing, then a piecewise map pins each baked beat to the real spoken word at render — per-word AV sync even when TTS runs faster/slower than estimated.
  - 🎥 **OVERLAY MODE** — transparent motion graphics **composited onto your own footage**: scenes render on a key color (`#050510`) with every stage layer stripped, ffmpeg `colorkey` makes them transparent and overlays them on a continuous slice of the base video (consecutive scenes ride one shot); the codegen doctrine flips to edge/lower-third zones, center 40–50% kept clear, 3-layer text shadows, no solid panels/backdrop-filter (lint + a center-coverage render gate enforce it). Toggle + footage path in Output config.
  - 🎨 **Consistent-scenes toggle** (every scene locked to the guide bg + first accent) and 🖼 **Image-full mode** (a project asset becomes the center hero at ~75% with Ken Burns; assets are assigned to scenes by the master engine and inlined as self-contained data URIs).
  - ✏️ **Edit a scene by prompt** — type an instruction ("make the number gold, move the chart left") and one LLM call rewrites the scene's current source; the result passes the same lint/render gates as fresh codegen, snapshots a take, and re-renders. `POST /scenes/:id/edit-html`.
- 🎼 **AI sound design** — one call reads the finished cue sheet + your BGM/SFX library and returns a plan (one mood-matched BGM + SFX placed on key moments, volumes clamped, never two SFX within 1s); falls back to the deterministic ambient bed + chapter whooshes offline. Toggle in Output config.
- 🤖 **LLM subtitle correction** (whisper-transcription lane): fixes misheard proper nouns/numbers/foreign terms while an enforced contract keeps every timestamp + block count; the align engine never needs it (script words are displayed verbatim). Toggle in AI settings.
- 🌍 **12 narration languages** with per-language voice notes (vi en fr de es pt-BR hi ja ko zh th id) + script-specific typography rules (Devanagari/Thai line-height, CJK weights) carried into codegen.
- ✨ **GSAP 3.13 deeply integrated (all premium plugins, free)** — every scene gets high-end effects *while staying deterministic frame by frame*: 3D per-character flying text (SplitText), self-drawing icon strokes (DrawSVG), counters + gauge arcs, hacker-style decoding text (ScrambleText), bouncing falling stars, physics confetti (Physics2D), 3D perspective cards, racing bars, CustomWiggle shakes.
- 🩹 **Self-healing, no babysitting needed** — every step auto-retries with backoff; the LLM supports **multiple rotating API keys** (paste several keys separated by commas/newlines — a key that hits its quota is skipped automatically) + a **fallback model** (`modelFallback`); a failed scene render auto-switches to a backup template and retries; after render there's a step that **inspects each mp4 file** (ffprobe: duration + both streams present + A/V matches the voice — a silent scene is an error and is never shipped) and re-renders broken scenes; a pipeline that hits an unexpected retryable error auto-resumes once; if the server crashes → orphaned jobs are requeued at boot. The UI clearly shows "🩹 đang tự thử lại".
- 🔬 **Final integrity gate (B8)** — the assembled video is checked for stream presence and duration (off by >8%); results land in `qc_report.json`. The per-frame black/white/silence scanning was retired (P38) — the fence parser + lint + the harness-owned dark backdrop already prevent blank scenes at the source, so the heavy scan was redundant. Disable with `qcGate:false`.
- 🎙️ **Consistent voice across the video** — the chosen voice is "locked": a TTS failure retries the same voice 3 times before falling back, the edge fallback lane picks the **nearest cached voice** (timbre-preserving), and any scene that had to use the fallback voice is **auto-retried with the primary voice** at the end of the step; every scene passes through **per-scene EBU R128 loudnorm** + a 650ms (vi) / 400ms (en) breath-pad.
- 🔊 **Automatic chapter-transition SFX** — an offline-synthesized whoosh (deterministic) placed at the exact timestamp of each chapter change, mixed under the voice. Disable with `autoSfx:false`.
- **Full automation (on by default)**: 🎙️ **neural voice auto-matched to each scene's language** (vi/en/ja/ko/zh/ru — never reads the wrong language) · karaoke subtitles · 🎵 automatic background music · volume normalization + fade · 📊 metadata **including YouTube Chapters** · a nice thumbnail (the master engine's thumbnail brief when available). The video is the script's scenes and nothing else — the ending is the script's own closing-CTA scene, designed by the codegen LLM like every other scene (no canned "thanks for watching" card), and per-project seed salting keeps every video's motion/ambience unique (P31).
- **Audit-grade processing journal ("Nhật ký xử lý", P32)**: every run writes a persistent, Vietnamese, per-run journal — grouped by stage with measured durations, scene-linked lines, retries/errors highlighted, filter/search/export — that survives reloads and restarts (a video finished last week still tells its full story). A global **🗂 Tác vụ** view lists every queued/running/recent task across all projects.
- **CTA discipline (P33)**: a video carries exactly ONE soft CTA (~30%) + ONE closing CTA, and never says goodbye mid-video. Long videos get a pinned outline (throughline/spine/chapters) that every batch follows, an explicit per-batch CTA plan (prohibitions included), a deterministic farewell/CTA detector with an editorial rewrite lane, and a strip/drop floor that cleans even pasted scenes-JSON. `scripts/cta-audit.mjs` prints any script's CTA map.
- **Smarter assistant (P34)**: the review sheet gains a script-approval gate (see the storyboard before any TTS money), an honest cost estimate, and lands you on the new project after accepting; the researched topic always feeds the script engine (a click-title is display metadata); suggestions follow the channel's language; failed scheduled slots return their idea to the pool; series episodes get a reviewed config.
- **Raw-GSAP reference port (P39)**: the codegen path is a faithful port of the reference app — the model authors a **raw GSAP timeline** (the full `gsap.*`/`tl.*` API, not an FX-only subset), against the reference's **hardcoded integer layout thresholds per aspect ratio** (byte-exact at standard resolutions), with the reference's cinematic dark stage and **crf-18** encode. Codegen defaults to a **strong model** (`ag/gemini-pro-agent`) with generous token headroom — visual quality is dominated by the codegen model, so this is the biggest single lever. Each scene's **backdrop style still rotates** (spotlight / aurora / grid / blueprint / …) while palette + fonts stay locked, so a video never reads as the same dark stage every cut. Retained on top of the reference (harness-side, invisible to the port): per-word **beat-sync time-warp**, deterministic frame render, and karaoke captions.
- **Reference feature parity — and past it (P40)**: five capabilities ported from the reference app, each landing a notch above it.
  - 🧊 **Real 3D and generative canvas in a scene**: a scene may reach for **three.js** or **p5.js** (vendored via `npm run libs:build`; only what a scene references is injected). They stay frame-exact because the harness gives them one public hook — `window.__onSeek(t)` — so the layer is a pure function of scene time under out-of-order scrubbing. Our headless Chrome runs software WebGL, so a three.js layer actually renders: **the reference app caches three.js but cannot draw it** (it launches with software rasterization disabled).
  - 🎭 **Brand artwork casts itself**: the AI picks mascot cutouts and concept art from your Brand library for the scenes they genuinely fit (never all of them), keeping the cutout's **transparency** and placing it as a co-star beside the type — not a cropped full-frame hero. `Tự động` (Default folder) / a specific folder / `Tắt`.
  - 🖼 **The AI designs the thumbnail**, as a real static HTML composition shot by Chrome — not a title bar over a frame grab — with three distinct A/B compositions, your locked palette and fonts, and a deterministic fallback so a thumbnail never fails a render.
  - ✂️ **Sửa video: motion graphics onto a video you already have** — it transcribes your file, cuts it on sentence boundaries, designs a transparent overlay per segment and composites each one onto **its own moment** of the footage, keeping your original picture and sound. No TTS is spent. Transcript quality is the ceiling, so the app now prefers the **largest whisper model present** (`npm run whisper:build` installs large-v3-turbo) and runs an AI spelling/diacritics repair over the transcript that is rejected wholesale if it would change the line count. Two optional passes ride the footage itself: **cắt bỏ khoảng lặng** (dead air over 0.6s is trimmed — before transcription, so subtitles and scenes stay exactly in step, and a beat of every pause is kept so nothing lands on a hard splice) and **tự động zoom nhẹ** (a Ken Burns push-in on even scenes, pull-out on odd, so a fixed-camera shot never sits still — the graphics keyed on top do not move with it).
  - 🔊 **Supertonic** — a local, free, offline neural voice (`pip install supertonic`): 10 voices × 9 languages, started/stopped from the app, with a deep health check that catches a server that answers HTTP but cannot actually speak. *(The reference's CapCut voice is deliberately not ported — it works by forging device fingerprints against a private endpoint.)*
  - 📘 **Publish to a Facebook Page too** — vertical video goes up as a **Reel**, anything else into the feed, and either can be **scheduled**; YouTube gained scheduling as well. Anything but an explicit "công khai ngay" is staged, never instantly public. Your publish history is now visible under the finished video.
  - 🖼 **A real image search with no API key** (Openverse, commercial-use licences only), remote pictures downloaded into the project so scenes stay offline, a **browsable brand library** (folder picker, audition BGM/SFX, rename), and the thumbnail designer can use **your own pictures**.
  - 🔇 **Silent mode**, ⚡ **speed/pitch/volume on the free Edge voice**, 🔑 **key pools** for paid voices (rotate on a credit refusal, so one exhausted key can't change the narrator mid-video), and **SEO written from the actual narration** — with named, reusable SEO styles.
- 🎙️ **Multi-provider voice library**: Edge Neural (322 voices, free) · macOS say (offline) · **Supertonic** (local, offline, free) · **Vbee** (Northern/Central/Southern Vietnamese voices) · **LarVoice** (official larvoice.com API — ~300 vi/en/zh/ja/ko voices, **0-credit previews** from bundled samples) · ElevenLabs · OpenAI — search/filter by language + gender, **▶ preview every voice** (cached), ⭐ pin, set a **default voice per language**; each provider has its own config form + a 🔌 Test-connection button. API keys are masked with `••` at every exit point.
- 📺 **Multi-channel (Channels)**: each channel gets its own folder (`~/Movies/AI Video Studio/<channel>/` — projects, library, output, channel.json) and its own config (voice, theme, watermark, aspect ratio…) that is inherited into every new video; switch channels with one tap in the sidebar; finished videos land in the channel's `output/`.
- 🏷 **Per-channel Brand Kit** (all placements FIXED — no auto/smart magic): channel-name badge at a dragged position (3 styles: text/pill/neon underline) + stickers; the channel name auto-fills the opening scene label + outro CTA "Đăng ký <channel>". Layered config: channel → default preset → panel (a single merge point, `src/core/config.js`).
- 🎞 **Whole-video logo stamp (WYSIWYG)**: the ONE logo lane — burned ONCE at final assembly in every visual mode. True-aspect preview at the real render ratio, **corner presets** (4 corners with a small edge gap) or free drag, resize 2–40% (slider/wheel/corner-handle/arrow keys, snap guides), live px readout — and the preview is **pixel-exact** against the render: one shared formula (`logoRect`) feeds both the ghost and ffmpeg, pinned by a raw-frame pixel test (P26).
- ©️ **Copyright watermark**: optional logo or channel-name mark **drifting slowly around the frame perimeter** (75s/lap default; 120s/45s options) at low opacity — deters re-uploads without hurting the picture. One path function drives both the live preview (×5 speed) and the pure t-based ffmpeg expressions, so what you see is what burns (P28). Toggle off = zero change to the output.
- 🎨 **Brand Asset generator** (reference-app clone): reference photo → AI emotion/action list (or manual) → character set via an OpenAI-compatible `images/edits` provider **picked right on the page** (model + size too); prompts are verbatim reference copies with one hardening — the background **must** be true-alpha transparent, enforced by an ffmpeg corner-alpha gate; batch-3 generation with stop/resume, per-item logs, copy-to-brand; primary model ×10 then loud failure — no fallback (P27).
- 🎛 **Per-channel Presets**: save an entire panel config as a named preset (e.g. "Short 4K", "Long 16:9"), set a ⭐ default — new videos on the channel (including those triggered via API/batch) pick it up automatically. AI settings (LLM/voice/subtitles) **override per channel individually**.
- 💬 **10 ready-made beautiful subtitle presets** (click to pick from the gallery, rendered with real fonts): Karaoke Vàng, Impact Đậm, Neon Rực, Bản Tin (box), Điện Ảnh, Tối Giản, Pop Tròn, Thể Thao, Punch, Terminal — 8 offline vendor Vietnamese fonts (rebuild with `npm run fonts:build`) + auto-switch to a system font for Japanese/Korean/Chinese; applied to the scene captions (rendered as styled DOM in the render harness).
- ⚡ **Subtitles are printed on the finished video, so you can always change them** — they are burned onto the assembled programme with libass, never baked into the individual scenes. Editing the text, font, size, colour or position afterwards costs **one join** instead of one render per scene, and it stays that way forever, because captions that are already in a clip's pixels cannot be taken back out. The karaoke reproduces the old in-scene look exactly — one accented word, the rest dimmed — rather than ASS's own progressive fill. Two honest differences: long lines wrap where the DOM lane shrank to fit, and `glow` is approximated with outline+shadow. Clips still leave the caption band clear whether subtitles are on or off, so turning them on later never means re-rendering anything. A video made before this rule moves over on its next config save, and the cost table tells you what that one-time re-render costs first.
- 💾 **Your channel remembers its subtitles** — change the font, size, colour, preset or position and it is saved onto the channel you are working in, right then; the next video starts with it. Turning subtitles **off** keeps the style, so turning them back on brings your look back exactly as it was. The panel now also opens on the active channel's own settings, and "video mới" returns to them instead of inheriting whatever the last video happened to use.
- 🔤 **42 typefaces, and the app never substitutes one behind your back** — one registry drives the picker, the preview and the render: 8 vendored, macOS system faces (the practical answer for CJK/Arabic/Thai/Devanagari), and the rest fetched from Google Fonts on request. Each option is drawn **in its own typeface**, and one that has not been downloaded says so with a button to get it. The preview loads the real font file and draws the actual style — weight, outline/glow/box, case, position, karaoke — instead of a coloured word in the app's own font. A family the renderer cannot resolve **stops the render with a message**, on both the browser side and the libass side; a silently substituted typeface is a finished video in the wrong face. Scene pages now embed only the fonts they use (757KB → 470KB each).
- 🎞 **Xem trên khung thật** — check a logo or a subtitle on a **real frame of your finished video**, through the real final pipeline (same `logoRect` math, same libass burn). About a second, instead of re-concatenating for fifteen minutes to find out a badge was four pixels too high.
- ♻️ **A finished video is a version, not a dead end** — "Áp dụng thay đổi" shows a **cost table before you spend it**: every step named, how many scenes, roughly how long, re-voicing flagged because it costs money, and the cheap subset offered next to "apply everything". The estimates come from your own project's measured times. Turning the logo off, swapping the music or restyling burned subtitles are all **one join** — the app copies the video stream instead of re-encoding it whenever no filter is needed (measured: 38.4s full encode → 4.6s stream copy).
- 🎬 **Changed the logo or the subtitles? Re-render the finished video from where you changed it** — saving the Brand Kit or editing subtitles offers to rebuild the video you have open, and hands you the cost table first. The **live processing log opens by itself** and the join now reports its own progress (it used to run for up to a quarter of an hour in complete silence, which is indistinguishable from a hang).
- 🕘 **Versions · alternate cuts · click-to-scene · check** — every export you have ever made is listed with what changed and a one-click way back (the files were always on disk; nothing indexed them). Export a second cut from the same clips — no logo, no music, no watermark — for the price of a join. Click a moment in the finished video to open the scene behind it. And **🔬 Kiểm tra** scans a finished project for on-screen text in the wrong language, number conventions from the wrong locale, blanked labels, and above all a clip on disk that no longer matches its design in the database. It reports; it never edits.
- 👁️ **Live per-scene preview** — click ▶ on a scene card: the animation actually plays with sound right inside the app, no render needed. A **contact sheet** endpoint renders one thumbnail per scene for a whole-video look.
- ✏️ **Edit text on a scene** (heading/sub/label/props) + change a scene's template + regenerate the preview instantly.
- 📦 **Batch run** — paste multiple topics (one video per line), the app processes them one by one overnight.
- 📑 **Export a whole-video .SRT file** (on the correct timeline) to upload YouTube subtitles; **export the canonical scenes JSON** from the Studio toolbar.
- **Aspect ratios**: 9:16 (TikTok/Reels), 16:9 (YouTube), 1:1, 4:5.
- **Long videos, no problem**: batched script generation + processed scene by scene + concatenated incrementally → RAM doesn't grow with length.
- **Fully customizable subtitles**: two display modes — 🎤 **karaoke** (per-word highlight riding the real voice timing) or 📄 **plain** static lines — and three chunking modes: natural 5–7-word phrases, **one cue per sentence** (wraps to max 2 lines), or a **fixed N words per line** (2–10). Every mode is rebuilt from the same word-level timestamps, so subtitles always stay glued to the voice (P29). Font, size, weight, color (palette + custom), position — and the picked font is **guaranteed to render** in the scene captions, with a loud warning if a family can't load (P30).
- **Scene grid**: view/regenerate voice · regenerate scene · re-render individual scenes.
- **Library** for Brand / BGM / SFX, **Brand Asset Gen**, **Edit Video** (trim), **Metadata** (title/desc/hashtag), **SRT editor**.
- **Real-time progress** over WebSocket, **stop / resume**, **parallel render**.
- **Pluggable AI, with an offline fallback**:
  | Step | Online (plug in a key) | Offline default |
  |------|------------------|------------------|
  | Script / Metadata | OpenAI-compatible (GPT/Gemini/Claude…) | Smart sentence splitting |
  | Narration (TTS) | Edge / Vbee / LarVoice / OpenAI / ElevenLabs | **macOS `say`** (has a Vietnamese voice) |
  | Subtitles | — | **align** (whisper timestamps + exact script text) or **estimate** |
  | Scene build | HyperFrame LLM codegen | **kinetic-statement fallback** (headless Chrome) |
  | Concat/Render | — | **ffmpeg** |

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

**Platforms.** One target: **macOS 11+ on Apple Silicon**. `npm run release` builds exactly
`AI-Video-Studio-v<x>-macos-arm64.zip` — there is no second platform, and there cannot be one
without a second shell: the launcher is Swift against Cocoa + WebKit. What ships inside the
bundle, verified by `file` on the artifacts themselves:

| Piece | Arch | Note |
|---|---|---|
| launcher, `vendor/node` (22.x), `better-sqlite3` | arm64 | Intel Macs cannot run this bundle at all |
| `vendor/ffmpeg`, `vendor/ffprobe` | **x86_64** | static libass build; **needs Rosetta 2**, and is 4–7× slower than a native ffmpeg, so `paths.js` prefers a Homebrew one when the machine has it |
| Chrome | — | **not bundled**; falls back to `/Applications/Google Chrome.app`, and without it scene rendering and thumbnails have no engine |
| whisper + model | — | not bundled (547 MB); downloaded on demand from Settings |

Unless `APPLE_SIGNING_IDENTITY` + the notarytool credentials are set, the release is ad-hoc signed
only and Gatekeeper blocks the first launch until the buyer right-clicks → Open.

**Dev:**
```bash
npm install              # needs Node 22 (e.g.: /opt/homebrew/opt/node@22/bin)
npm start                # server picks a port, prints "AVS_READY <url>"
npm test                 # unit + protected-behavior suites (Node 22)
npm run test:e2e         # end-to-end video-creation test
npm run fonts:build:ui   # re-download Lexend/JetBrains Mono for the UI (public/fonts) — does NOT touch scene fonts
npm run fonts:build      # ⚠ fonts for SCENE render (vendor/fonts) — changing this affects video byte-compat
npm run libs:build       # creative runtime libs for scenes (vendor/libs: three.js, p5.js, …)
npm run whisper:build    # bigger whisper model (vendor/whisper/models) — the ceiling for "Sửa video"
npm run icon:build       # render shell/icon.svg → shell/AppIcon.icns (headless Chrome + sips + iconutil)
```

---

## 🔑 Licensing & release

The app is sold through the Tools Platform store and is unlocked by **signing in with the Google
account that bought it**. The lock screen leads with one button: the app starts a loopback
listener, opens the system browser at the store's sign-in, and when the browser lands back the
customer's licence is found and activated by itself — nobody types a key (a collapsed key field
remains as a support fallback). The app then runs offline against a signed RS256 token it verifies
itself. A lapsed subscription keeps working through a 7-day grace window rather than stopping the
day a card fails, and the app checks in with the store roughly every six hours to renew the token
or learn that the licence was revoked. Signing out forgets the session and the licence together.

Device seats are counted by the store: freeing one happens on the store's Devices page (once every
30 days) or by the admin — deliberately never from inside the app.

Running from this repo nothing is locked: a checkout with no store baked in (and no
`TOOLS_PLATFORM_URL`) simply runs. `TOOLS_LICENSE_BYPASS=1` skips the check for local work, and is
deliberately dead inside a shipped bundle. Store integration is configured with the platform's
cross-app environment names — the same set every desktop app in the store uses:

| Variable | Meaning |
| --- | --- |
| `TOOLS_PLATFORM_URL` | store origin (dev: `http://localhost:4311`) |
| `TOOLS_STORE_CLIENT_KEY` | `client`-scope API key for this product |
| `TOOLS_STORE_PUBLIC_KEY` | RS256 public key (dev convenience; baked at release) |
| `TOOLS_PLATFORM_WEB_URL` | dev-only: web origin when it differs from the API |
| `TOOLS_DEV_LOGIN_EMAIL` | dev-only: sign in without Google via the store's dev-login |
| `TOOLS_UPDATE_CHANNEL` | release channel to follow (default `stable`) |

**Building something a customer can actually run** — the ordinary `shell:build` bundle points at
*this* checkout and only works on this Mac:

```bash
npm run node:fetch                              # portable Node runtime → vendor/node (once)
npm run shell:build:dist                        # self-contained "AI Video Studio.app"
npm run release -- --version 1.1.0 --notes "…"  # build, sign, upload and publish to the store
```

`release` needs `TOOLS_PLATFORM_URL`, `TOOLS_STORE_CLIENT_KEY` (baked into the build) and
`TOOLS_STORE_PUBLISHER_KEY` (never baked). Add the `APPLE_*` variables to get a notarised build;
without them the release still completes and says plainly that customers will meet Gatekeeper.
Distribution is the store's licence-gated download link — no app store, no GitHub releases.

---

## 🧱 Architecture

> The full living map (layer boundaries, target architecture, the P1–P19 protected-behavior
> registry, and the "want to change X → go to file Y" table) lives in
> [`docs/architecture.md`](docs/architecture.md). Summary:

```
AI Video Studio.app   ← Swift shell + WKWebView (shell/main.swift)
   └─ spawn Node 22 backend (src/server.js) → wait for /api/health → load localhost
src/
  server.js            Express + WebSocket + static SPA + boot recovery + scheduler start
  config/paths.js      resolve ffmpeg/whisper/chrome/say (ENV → vendor → app root → system)
  core/                config layering (channel → preset → request) · pricing · budget · metering · errors
  db/
    connection.js        handle + schema (better-sqlite3) · migrate.js: versioned migrations + auto-backup
    repositories/        queries by domain: settings · projects · scenes · channels · jobs · usage · takes…
    index.js             barrel: re-export every repo + seed/backfill
  api/
    routes.js            REST API (thin-ish; fattened by v3 — split into routes/ is the open refactor)
    services/            business logic: assistant · topic-autopilot · batch · voice-preview · voice-catalog · file-access (allowlist)
  content/             master-script.js (B2 master engine: prompt/validate/repair/batching) · scorer.js (editorial detectors)
  pipeline/            runner.js (orchestrator) + stages/{script,editorial,budget,visuals,tts,render,finalize,metadata,publish}
                       scheduler (durable jobs) · governor (Chrome+ffmpeg semaphores) · direction (art-director pass)
                       estimate (timing seed) · fingerprint (content-hash resume) · qc · regen · repurpose · brandgen
  styleguide/          🎨 SHARED style contract (guide schema · 6 presets · themeFromGuide · AI guide generator)
  animation/           🎬 shared GSAP render engine (reused by hyperframe): harness (seekable page) · renderer (frame loop)
                       templates/ (kinetic-statement fallback · chapter-break · hyperframe shell) · headline · themes · timewarp · gsap bundle
  hyperframe/          ✨ LLM-writes-GSAP system: codegen · validate (render QA) · prompt · beats · icons (~130) · lint · signatures
  providers/           llm (master + legacy paths) · tts + voice/* · subtitle (align/whisper/estimate) · imagegen · trends · fetchlink
  publish/             YouTube upload (OAuth loopback, staging-first)
  media/               ffmpeg · master (−16 LUFS two-pass) · align · waveform · say · whisper · puppeteer
  subtitles/           10 caption presets
public/                "Studio Pro" SPA: index.html + css + fonts (Lexend UI)
  js/                  ESM modules: main.js · state.js · api.js
    ui/                  dom · icons (SVG set) · toast · dialog · modals · palette (⌘K)
    views/               nav · home · studio · scenes (grid+patch) · player · progress · config · library · brandgen · editvideo
    features/            settings · voicepicker · channels · brandkit · srt · batch · autopilot · assistant · scene-studio · template-gallery
vendor/ffmpeg/         static ffmpeg/ffprobe (with libass — the Homebrew build lacks it)
vendor/fonts/          fonts.css for SCENE render (data-URI, offline — don't confuse with UI fonts)
vendor/gsap/           GSAP 3.13.0 + SplitText/DrawSVG/MorphSVG/MotionPath/Physics2D/ScrambleText/CustomEase…
```

**System dependencies** (auto-detected, preferring `vendor/`, then the app root, then system):
ffmpeg (libass), whisper.cpp + the `ggml-small.bin` model, Chrome for Testing, `say` (macOS).

---

## ⚙️ AI configuration (optional)

Go to **⚙️ AI Setting** in the app to plug in:

- **LLM**: pick a provider from the list and paste a key. The base URL, the suggested models and
  that provider's quirks come with it; `↻ Lấy danh sách model` asks the provider what it serves
  right now. Every provider keeps its own key and model, so switching between them is free.
  Choose **Tuỳ chỉnh** to type a base URL by hand — any OpenAI-compatible endpoint works, several
  keys separated by newlines rotate, and `modelFallback` is still an optional hidden knob.
- **TTS**: choose `say` (offline) / Edge / Vbee / LarVoice / ElevenLabs, or the OpenAI-compatible
  voice with a provider picked from the same list.
- **Subtitles**: `align` (recommended — whisper timing with 100%-accurate script text) or `estimate` / `whisper`.

With nothing plugged in it still runs fully using the macOS voice + ffmpeg.

**Which provider to pick.** Free with no card: **Google Gemini** (AI Studio), **Groq**,
**Cerebras**, **OpenRouter**'s `:free` models. Cheap pay-as-you-go: **DeepSeek**, **Z.ai**,
**Moonshot**, **Together**. Offline and free forever: **Ollama** / **LM Studio** on your own
machine. Prices shown next to each model come from `src/core/pricing.js`, the same table the cost
meter bills against — they are estimates, and they go stale, so treat them as a guide.

> **HyperFrame needs Gemini.** Scene graphics are written as code, and measured against every
> other family only Gemini produces markup that renders. A provider without Gemini is fine for
> scripts and metadata but cannot drive HyperFrame, and AI Setting says so when you pick one.
> Gemini and OpenRouter both serve one; anything else needs a second key, or a codegen model
> named by hand if your endpoint serves Gemini under another name.

---

## 📂 Data & logs

All projects, media, and the DB live in `data/` (gitignored). Each project has its own folder:
`data/projects/<id>/{audio,srt,html,render,output}` + the canonical `scenes.json` artifact.
`JOURNAL.md` is the daily production log — real stats appended from the live DB by a scheduled
`scripts/journal.mjs` run (see `scripts/install-journal-schedule.sh`); don't edit it by hand.
