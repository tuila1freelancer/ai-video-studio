# Upgrade report — AI Video Studio meeting the @TuiLa1Freelancer channel bar

> Date: 2026-07-10. Document chain: [quality-bar.md](quality-bar.md) → [reference-app-analysis.md](reference-app-analysis.md) → [gap-analysis.md](gap-analysis.md) → this report.

## 1. What changed (following the U1–U10 list from gap-analysis)

| # | Upgrade | File | Status |
|---|---|---|---|
| U1 | **Art-director pass** — cinematic visual direction `[LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]` for EACH scene, batches of 14 scenes for a global view, visual rhyme hook↔climax, skip on resume | `src/pipeline/direction.js` (new), `src/pipeline/runner.js` | ✅ |
| U2 | **Style Guide v2** — schema adds `semantics` (semantic colors), `conceptMap` (concept→visual formulas), `hud` (kickers + statuses), `sceneRules`; new preset **TuiLa1 HUD Cyber** distilled from the quality-bar; `generateStyleGuide` AI-generates all v2 fields | `src/animation/templates/hyperframe.js`, `src/hyperframe/styleguide.js` | ✅ |
| U3 | **Codegen v2** — guide v2 embedded into the prompt of every scene; visual-rhyme for the closing scene; the structured brief is respected; new "timid scene" check in renderValidate (hero < 34% width → require scaling up) | `src/hyperframe/prompt.js`, `codegen.js`, `validate.js` | ✅ |
| U4 | **Script v2** — PAIN→PROMISE hook with numbers; mid-video CTA + comment-baiting question at the end; word count scaled to per-language reading speed (vi 4.4 words/s — previously 2.6, which left scenes short); later chapters see the ending of the previous one; enforce the correct scene count (≥70%, retry 3 times); `config.language` | `src/providers/llm.js` | ✅ |
| U5 | **Thorough consistency** — fallback + outro scenes in the HyperFrame project use the theme from the guide (no more tonal mismatch); thumbnail follows the guide palette | `src/animation/index.js`, `src/pipeline/visuals.js`, `runner.js` | ✅ |
| U6 | **Voice v2** — voice-lock (retry the same voice 3× before falling back + auto-retry the main voice at the end of the step); loudnorm EBU R128 per-scene; breath padding 650ms vi/400ms en; project-level provider pick beats the default langVoices (bug fix); silent scene = hard error | `src/providers/tts.js`, `src/media/ffmpeg.js`, `runner.js` | ✅ |
| U7 | **Quality gate B8** — decode the final video to scan blackdetect/silencedetect/stream/duration; errors traced back to a scene → re-render that exact scene + reconcatenate (1 cycle); `qc_report.json`; per-scene check for both streams present + A/V matching the voice | `src/pipeline/qc.js` (new), `runner.js` | ✅ |
| U8 | **LLM retry v2** — multiple API keys rotated (comma/newline-separated), error classification 401/403/quota (drop the key) vs. transient (backoff), `modelFallback`; **max_tokens floor of 16k** for reasoning models (fixes truncated-fragment responses); chatJson auto-disables JSON-mode when the backend does not support it (fixes Gemini-like proxies) | `src/providers/llm.js` | ✅ |
| U9 | **Chapter-transition SFX** — offline deterministic synthesized whoosh placed exactly at the chapter-break timestamp, mixed under the voice | `src/media/ffmpeg.js`, `src/pipeline/render.js`, `runner.js` | ✅ |
| U10 | Whisper retry ×2; metadata retry ×2 | `src/providers/subtitle.js`, `runner.js` | ✅ |

Three real bugs in the old version were found and fixed thanks to live testing: (1) Gemini-like proxies return garbage when `response_format: json_object` is enabled → every chatJson call died silently; (2) reasoning models had their `max_tokens` throttled → the script fell back to the offline splitter; (3) `langVoices` overrode the project's explicit TTS choice.

## 2. Verification results (Phase 5)

### 2.1 Self-recovery layers verified LIVE (not simulated)

| Situation | Observation | Result |
|---|---|---|
| LLM fully down (json-mode bug, before the fix) | B2 + direction fell back to offline/heuristic, the pipeline still produced a complete video | ✅ never dies |
| Weak codegen model returns the wrong format 4 times | The scene fell back to the fallback template, the video still exported, the theme still followed the guide (U5) | ✅ |
| Render frame timeout (Chrome overloaded) | Auto-switched to the fallback template and re-rendered, B6 completed | ✅ |
| QC detected an error in a scene | Auto re-rendered that exact scene + reconcatenated + QC again; if warnings remained, exported alongside `qc_report.json` | ✅ |
| Main TTS provider down (elevenlabs with no key) | Retried the same voice 3× → fell back to edge, flagged `fallback:true`, the runner auto-retried the main voice at the end of the step | ✅ (unit test) |
| Project-level TTS pick | `tts:{provider:'edge'}` beat the default langVoices | ✅ (unit test, after the fix) |
| Delete scene clips + resume | Deleted `scene_001.mp4` from a done project → `scripts/resume.mjs`: re-rendered only the missing scene (keeping the TTS + spec), reconcatenated + re-QC'd, produced a new video | ✅ |
| Mass 429 rate-limit (39/42 scenes) | The pipeline still completed a 7.1-minute video, QC clean; fallback scenes still carried the correct channel signature thanks to U5; then resume-heal with 429-backoff + modelFallback auto-upgraded the scenes | ✅ |

### 2.2 Test videos

| | Test 1 | Test 2 |
|---|---|---|
| Config | 9:16, 60s, HyperFrame, preset TuiLa1 HUD Cyber, TTS edge, codegen `ag/claude-sonnet-4-6` | 16:9, 300s, same as Test 1 + `modelFallback: ag/gemini-3.1-pro-low` |
| Script | 9 scenes (correct count), pain→promise hook, ~50 words/scene | 42 scenes two-stage (5 chapters + mid CTA + comment bait), title "5 Sai Lầm Khi Dùng AI Khiến Bạn Mãi Dậm…" |
| Visual | **9/9 scenes HyperFrame, 9/9 with cinematic direction, 0 fallback** | 42/42 with direction; first pass 3/42 HyperFrame (429 rate-limit) → **after resume-heal: 41/42 HyperFrame** (§2.4) |
| QC (B8) | **✅ Clean: no black frames, no silent gaps, duration matches** | ✅ Clean on both builds (qc_report.json `ok:true`, 0.03s duration drift) |
| Output | 105.4s, 15.5MB, 1080×1920@30 | 428.8s, 72.5MB (healed build), 1920×1080@30 |
| Wall time | 37.8 min | 44.4 min (first run) + background heal |

### 2.3 Scoring against the quality-bar (self-reviewed on frames extracted from the finished video)

**Passed (compared directly against channel video frames):**
- A. Visual: deep-navy background hard-locked on 100% of scenes, no bright-background scenes; live ambient (particle + glow + grain); palette + semantic colors correct (valid source = leaf border + ✓, fabricated link = red border + warning, "laziness" = risk pink); 1 focal element/scene.
- B. Motion: each scene has 1 primary animation + ambient; beat-sync matches the dialogue (element appears when the voice mentions it); gradient progress bar at the bottom; glitch only on warning scenes.
- C. Typography: mono UPPERCASE kicker with the `//` prefix on every scene; UPPERCASE heading with glow; on-screen text is a keyword drawn from the dialogue in the correct language; Vietnamese diacritics 100% correct (checked Ắ Ậ Ữ on the frame).
- D. Script: cold-open hook follows the formula; chapters numbered; mid + end CTA + comment-baiting question (verified by ear against the script transcript).
- E-F: karaoke chunks of 2-6 words with accent-colored keyword highlighting; watermark visible 100% of the duration; outro "CẢM ƠN ĐÃ XEM / ĐĂNG KÝ TUILA1FREELANCER"; visual rhyme (the hook's question mark returns in the closing scene at a larger scale).

**Not fully passed (noted in §3):** the "BOLD" factor — many AI scenes have a focal element only ~25-35% of the frame width vs. the channel standard of 55-75% (added a "timid" 42% check + a SCALE CHECK rule to the prompt for later runs); duration overran the target (+75% on test 1) because the model wrote ~50 words/scene instead of 28-36.

### 2.4 Large-scale resume-heal (test 2) — the real sequence of events

1. First run: the proxy rate-limited (429) the sonnet model after 5 scenes → 39/42 scenes fell to the fallback template. **The pipeline still completed a 7.1-minute video, QC clean** — the fallback video still carried the correct channel signature thanks to U5 (the guide theme covers fallback scenes too).
2. Diagnosed → patched 3 spots: dedicated backoff for 429 (8s/20s/45s, 4 attempts/key), `hyperframe.modelFallback` (switch models instead of falling to a template), B5 re-codegen deletes the old `video_path` so upgraded scenes get re-rendered on resume.
3. `resume.mjs` (switched the main model to `ag/gemini-3.1-pro-low` because sonnet exhausted its quota): **B5 auto-upgraded 3/42 → 41/42 HyperFrame scenes, re-rendered exactly the changed scenes, reconcatenated + re-QC'd → PASS**, new video 428.8s / 72.5MB, `qc_report.json` `ok:true` (0.03s duration drift).
4. Comparing frames of the healed build: the focal element is large and clear (yellow hammer at hero-scale, input/output cards with red-yellow semantics, bright stepper node, few-shot browser mockup) — the new SCALE CHECK took effect right within the heal loop.

Plus a real incident mid-run: one server was killed during rendering → the DB was stuck in `running` (zombie) → killed the process, resumed → the pipeline continued exactly where it left off (`already rendered: 11`, rendering only the missing part). This is precisely the "server crash → Resume continues" behavior described in the README, verified live.

## 3. Remaining limitations / next steps

1. **Boldness of AI scenes**: the "timid scene" check (42% width) is still only a soft defect — if the model stays timid after 4 tries, the scene still ships. Consider: increasing the default size of the `.hf-kw/.hf-card` classes, or promoting it to a hard defect when heroFrac < 30%.
2. **Duration overrun**: the model writes longer than the safe range (50 vs. 28-36 words/scene). Consider adding a step to trim/split overly long scenes after B2 (split scene > maxWords×1.4), or accepting it (the reference channel also overruns by +29%).
3. **Strong-model rate-limits**: 42 scenes × 4 attempts at concurrency 2 drained the proxy's sonnet quota. 429-backoff + modelFallback are already in place; consider also: lowering codegen concurrency after consecutive 429s, or a token-bucket queue.
4. **Evolving channel style** (M8 quality-bar): the glossy 3D icons in the channel's newer videos are not yet supported (currently pure line-art) — needs to be added to keep tracking the latest videos.
5. Recommended daily setup: Config → HyperFrame → Style **TuiLa1 HUD Cyber**, a strong codegen model (`ag/claude-sonnet-4-6`) + `modelFallback` (`ag/gemini-3.1-pro-low`), main TTS LarVoice (safe now with voice-lock + loudnorm), keep `qcGate`/`autoSfx` at their default of enabled.
