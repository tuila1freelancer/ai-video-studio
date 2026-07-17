# Feature gap matrix — reference app ("AI VIDEO Tool.app" v2.8.2) vs AI Video Studio

> Sources: full REST route dump (131 routes), frontend bundle (`public-dist/index.html` +
> `js/features/*`), every LLM prompt extracted from `server.bundle.cjs` (acorn AST dump),
> `pipeline.db`, and 22 real finished sessions (~2k rendered scenes). The code-level
> inventory is strictly more complete than a manual UI walk-through: every screen, toggle
> and pipeline step exists in `index.html`/routes, and every behavior in the bundle.
> Reference app remains READ-ONLY throughout.
>
> UI walk-through note: the app WAS launched (its backend serves `localhost:45678`), but
> its web UI sits behind the vendor's Google-login licensing wall in any fresh browser
> session — authenticating on the owner's behalf is out of bounds, so feature discovery
> relies on the (complete) markup/route/prompt inventory above: all 24 config checkboxes,
> every select, all 131 routes and the B1–B9/E1–E7 pipeline panels are enumerated in
> `index.html` and were cross-checked against the bundle's handlers.

Decision legend: **IMPLEMENT** (built in this repo), **HAVE** (already equivalent or better),
**ADAPT** (absorbed in different form), **DROP** (cost > value — reason recorded).

## A. Core video-quality features

| # | Reference feature | Where seen | Ours today | Decision |
|---|---|---|---|---|
| A1 | **Overlay mode**: HTML with bg `#050510` → ffmpeg `colorkey` → composited over source footage; zone layout (HEADER/SIDEBAR PiP/MAIN 40–50% clear/LOWER-THIRD), 3-layer text-shadow visibility rules, no solid panels/backdrop-filter | prompt #61 (19 KB), edit-video steps E4/E6 | none | **IMPLEMENT** — project-level overlay mode: owner supplies base footage, B5 uses the overlay codegen variant, render composites per scene, remainder of pipeline unchanged |
| A2 | **LLM SRT correction** vs original voice text (fix Whisper mishears: proper nouns, numbers, English terms), keep 100% timestamps + block count + word distribution | prompts #89/#90, per-scene `fix-srt` routes | forced-align (`media/align.js`) fixes timing, not wording | **IMPLEMENT** — optional post-align lane; timestamps/blocks pinned by contract |
| A3 | **LLM sound design**: pick BGM from library + place SFX at SRT timestamps (BGM 0.08–0.15, SFX 0.6–1.0, no overlap <1 s), output one JSON plan | prompt #95, `music_plan.json` in sessions | deterministic chapter-whoosh SFX + BGM config | **IMPLEMENT** — LLM plan with deterministic fallback to current behavior |
| A4 | **Consistent scenes** toggle: every scene forced to guide bg + first primary color | prompt block #33, `#consistentScenes` checkbox | per-guide palette lock (softer) | **IMPLEMENT** — prompt-block toggle |
| A5 | **Image-full mode**: project asset image/video as center hero covering 75% + Ken Burns; brand assets stay corner badges | prompt block #68, `#imageFullMode` | assets only as decorative refs | **IMPLEMENT** — prompt-block toggle + asset plumbing into codegen |
| A6 | **Edit scene HTML by prompt** (and thumbnail) | prompts #55/#56, `edit-html` routes | direct HTML editor (`custom-html`), take history | **IMPLEMENT** — LLM edit lane on top of the existing custom-html/take machinery |
| A7 | **Rich-animation block** (≥5 concurrent movers, particles, stagger) | prompt #34, `#richAnimation` | `density: minimal/balanced/rich` (rich default) | **HAVE/ADAPT** — our density=rich covers it while keeping the calm-first doctrine (their ≥5-concurrent rule contradicts our measured "calm one-mover" reference finding; not imported) |
| A8 | **8-mood visual-style layer** (Swiss Pulse / Velvet / Maximalist / Shadow Cut / Data Drift / Soft Signal / Folk / Deconstructed) | bundle style table | 5 motion signatures (`hyperframe/signatures.js`) | **ADAPT** — absorbed into the signature layer during P1 parity work |
| A9 | **ASPECT_RATIO_RULES hard numbers** per ratio (safe paddings, TEXT_MAX_W, HERO_MAX_W, LOWER_THIRD_Y=0.807H) | prompts #16–20 | prose margins + caption band note | **IMPLEMENT** (P1) — computed VIEWPORT numbers in the codegen prompt |
| A10 | **words/scene tables + per-language text rules** (11 languages with voiceNote, wordsPerSecond, script-specific line-height/overflow rules) | bundle language table | `LANG_WPS` 6 languages | **IMPLEMENT** — extend language table (fr/de/es/pt-BR/hi/ja/ko/zh/th) for script + codegen |

## B. Pipeline / product modes

| # | Reference feature | Ours today | Decision |
|---|---|---|---|
| B1 | **Edit-video mode** (E1 transcribe → E2 cut — silence-removal/auto-zoom/smart-reframe → E3 visual briefs → E4 overlay HTML → E5 render → E6 composite → E7 concat) | none | **ADAPT** — its essence (motion-graphics over user footage) ships as A1 overlay mode on our normal pipeline. A full duplicate pipeline (cutting, reframing, silence-removal of arbitrary footage) is high-maintenance machinery for a separate product; not worth a second state machine. Revisit if the owner asks for true video editing. |
| B2 | **Thumbnail = LLM static HTML** page screenshotted | deterministic thumbnail composer + variants | **HAVE** (different route to the same artifact; ours is deterministic and free). LLM-edit of thumbnails follows A6 for scenes only — thumbnail variants remain deterministic. |
| B3 | **Brand-gen / mascot** (character emotion set generation from reference image, prompts #99/#100) | `POST /brandgen` (brand kit images) | **DROP** — needs a reference-image-consistent image model (their specific providers); our imagegen mesh has no identity-preserving mode, so results would be off-brand. Low video-quality ROI vs cost. Brand kit + logo badges already cover branding in-video. |
| B4 | **Asset match** (LLM maps uploaded files → scenes, #76/#86) | master JSON carries per-scene `assets` | **ADAPT** — assets flow with A5; the LLM matching step is folded into the master-script prompt contract (scenes[].assets) instead of a second call. |
| B5 | **Publish: Facebook Pages** (connect, token store/extend/check, upload, auto-comment, caption gen) | YouTube staging-first publisher | **DROP** (FB) — cannot be E2E-verified without the owner's FB page tokens; YouTube path already proves the publish lane. Caption/SEO generation is already covered by our metadata 2.0. Scaffolding can be added when the owner provides page credentials. |
| B6 | **TTS providers CapCut + Supertonic(local server)** | edge, vbee, larvoice, elevenlabs, openai, say | **DROP** — CapCut is an unofficial endpoint (breakage-prone); Supertonic requires installing/running a local model server. Six working providers incl. two free lanes already cover the need. |
| B7 | **X/Twitter scrape + Tavily extract** | `fetch-link` article extraction (B2 source mode) | **HAVE** (articles). X scraping **DROP** — fragile scraping of a hostile platform, low ROI. |
| B8 | **Image search: LLM keywords + Apify Google Images + proxy** | `POST /image-search` + `providers/imagesearch.js` | **HAVE** |
| B9 | **Aspect ratios 1:1 and 4:5** | 16:9 / 9:16 (+4K scale) | **IMPLEMENT** — cheap: `ratioToSize` + per-ratio viewport numbers (A9) unlock both |
| B10 | **Metadata styles CRUD** (user-defined SEO prompt presets) | fixed SEO 2.0 prompt | **IMPLEMENT (small)** — optional `config.metadataPrompt` override through the existing config layering (channel/preset/request) |
| B11 | **Parallel TTS / parallel render toggles** | governor semaphores bound Chrome+ffmpeg globally | **HAVE** (better: global fairness across runs) |
| B12 | **Logo presets / subtitle position UI** | brand kit + subtitle studio presets | **HAVE** |
| B13 | **Auth/licensing/payment (Google login, key top-up, anti-debug)** | n/a (local tool) | **DROP** — their SaaS business layer, irrelevant to video output |
| B14 | **Auto-concat toggle, mute-voice, per-scene re-render buttons** | render-only entry, review gate, per-scene regen/takes | **HAVE** |

## C. What the reference app lacks (kept ours — do NOT import their weaknesses)

- No render-validation / QC gate / quality tiers / render-crash self-heal — ours stays. (Codegen itself follows the owner's NO-FALLBACK contract, P25: primary model ×10 then loud fail.)
- Fixed-duration render (no per-word time-warp) — our beat-anchored warp stays.
- No broadcast master (−16 LUFS two-pass + sidechain ducking) — ours stays.
- No durable job queue / governor / content-hash resume / budget guardrail / gates — ours stay.
- No test suite / protected-behavior registry — ours stays (P1–P19 + new P20+).
- Script engine: topic(+assets) only — our 4-input master engine (topic/script/json/link) stays.

## Verification note

Each IMPLEMENT row ships with: code + config/UI toggle + named test + doc, and degrades
cleanly offline (LLM lanes fall back to the deterministic behavior they augment).
