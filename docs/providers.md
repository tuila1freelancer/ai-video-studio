# Providers and configuration

Every provider is optional. With none configured the app still produces a video, using the offline
script writer and the keyless voice.

## LLM

One protocol for all — `POST {baseUrl}/chat/completions` with a bearer key. Presets are data
(`providers/llm-presets.js`).

| Preset | Tier | Script + codegen | Also serves |
|---|---|---|---|
| Google Gemini | free | ✅ | image, TTS |
| OpenRouter | free | ✅ | — |
| Groq | free | — | TTS |
| Together AI | cheap | — | image, TTS |
| OpenAI | premium | — | image, TTS |
| Custom | — | ✅ | any OpenAI-compatible endpoint; `localhost` needs no key |

Only Gemini-serving presets get the script/codegen lane: that setting drives both, and scene quality
is dominated by that model family.

Runtime: multiple keys per provider with automatic rotation, four attempts per key per model with
`8 s / 20 s / 45 s` backoff, a wall-clock ceiling, and a deterministic offline writer as the floor.

## Voice — 11 providers

| | Free | Network | Notable |
|---|---|---|---|
| Edge Neural | ✅ | ✅ | keyless, ~400 voices, the default |
| macOS `say` | ✅ | — | fully offline |
| Supertonic | ✅ | — | neural, local server |
| Azure Speech | | ✅ | ~150 locales; `mstts:express-as` styles carry the per-scene mood |
| Google Cloud TTS | | ✅ | strongest for Hindi, Thai, Indonesian |
| Amazon Polly | | ✅ | speech marks give real word timestamps — no transcription pass |
| ElevenLabs | | ✅ | premium multilingual, also returns word timing |
| OpenAI TTS | | ✅ | shares the LLM preset list |
| Vbee · LarVoice | | ✅ | Vietnamese specialists |

The chosen voice is locked: three retries on the same voice before the chain may switch, then a
timbre-preserving fallback, then one more attempt at the primary at the end of the stage.
Implausibly long or short audio counts as a failed attempt.

## Other services

Image editing (OpenAI-compatible `/images/edits`) · image search (Tavily → keyless Openverse →
offline gradients) · ASR (local whisper.cpp) · trends (Google Trends and Google News in the
channel's own market, plus RSS packs) · article fetching with an optional AI refinement pass.

## Cost

Every LLM and TTS call is metered per video and streamed live (`provider_usage`, `GET /api/usage`).
Rates live in `core/pricing.js` — 44 model prefixes plus per-1k-character TTS rates. Cost is shown
before it is spent in four places: the scene gate, the change-plan table, the pending-changes bar
and the assistant's pre-create sheet.

## Configuration

Five groups in the Studio config column. Settings merge **app defaults → channel → preset → video**,
skipping only `undefined`.

| Group | Contents |
|---|---|
| Format & quality | visual style, motion density, creative direction, per-video codegen model, consistent scenes, image-full, brand-asset casting, overlay mode, fps, resolution, language, aspect, duration mode and lengths |
| Channel brand | Brand Kit (name badge, logo stamp, drifting watermark), brand display font |
| Subtitles | 30 controls — preset, mode, chunking, type, colour, outline, shadow, glow, box, position, motion — with a live preview through the real burn path |
| Voice & music | voice picker, BGM, automatic music, AI sound design, silent mode |
| Advanced | transitions and style, metadata and SEO style, auto-concat, review gate, scene gate, TTS and render concurrency, project assets |

Channel presets save and restore the whole panel; switching channel resets it to that channel's own
defaults.

---
