# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- VieNeu-TTS as a local bilingual (Vietnamese/English) voice.
- Open-source project files: MIT licence, contributing guide, code of conduct, security policy,
  issue and pull request templates.

### Changed

- `npm run release` builds, audits, signs and packages locally; it no longer uploads anywhere.
- Tool lookup (FFmpeg, Chrome, whisper) uses the same chain on every machine: environment
  override → system install → `vendor/` → `PATH`.

### Removed

- Licence activation, account sign-in and the in-app update check. A fresh clone runs with no
  account and no configuration.

### Fixed

- The top bar sheds labels in a fixed order instead of overlapping at medium window widths.
- Pronunciation-lexicon keys with capital letters now match exactly.

## [1.0.3] - 2026-10-01

### Added

- **Server mode** (`AVS_MODE=server`): bearer tokens with scopes, explicit channel selection on
  every creation path, machine-readable error codes, idempotency keys, a durable event cursor,
  signed webhooks and pause/drain/resume of the job queue.
- **Agent kit** (`packages/avs-kit`): an MCP server, a CLI and an SDK with no runtime dependencies;
  an OpenAPI document generated from the route table.
- Pre-publish verdict per project, publishing policy and YouTube quota tracking, and hard spending
  caps per video, per channel and per day.
- Desktop: single instance, menu-bar (macOS) and tray (Windows) presence, start at login, and an
  Agent panel to grant access and mint tokens.
- Linux server payload and a multi-stage Docker image.
- Script audit gate in the editorial pass and an on-screen number audit at the scene gate.

### Changed

- The interface is fully translated into all thirteen languages.
- One-request boot, code-split interface bundle, lazily loaded pages and per-area stylesheets.
- Large modules split into focused directories behind unchanged facades.

### Fixed

- Platform covers are named per project instead of overwriting the previous video's.
- Light style guides no longer get a near-black stage gradient or vignette.
- New channels on Windows are created under *Videos* rather than *Movies*.

## [1.0.2] - 2026-09-05

### Changed

- The Windows build ships its own FFmpeg with libass, so subtitles burn without a system FFmpeg.
- Hardened the Windows packaging steps.

## [1.0.1] - 2026-09-04

### Added

- **Edit video**: motion graphics designed for and composited onto existing footage, with optional
  silence removal and auto-zoom.
- AI-designed thumbnails (static HTML rendered in Chrome) with inspect, redesign, hand-edit and
  edit-by-instruction.
- Facebook Page publishing (Reels and feed video) beside YouTube, with scheduling and a composer
  that shows the exact post text.
- Brand-asset generation and automatic casting of brand art into scenes.
- Supertonic as a self-hosted local voice; Edge voices gain rate, pitch and volume controls.
- LLM sound design, LLM subtitle correction for transcribed footage, and creative runtime
  libraries (three.js, p5.js and others) driven deterministically by the render clock.
- Interface languages beyond Vietnamese, a per-run processing journal and a tasks view.
- Windows build.

### Changed

- HyperFrame is the only visual mode; scene code is authored as a raw GSAP timeline.
- Codegen uses the primary model only and fails loudly instead of falling back.
- Layout guidance spreads compositions evenly across the frame.

## [1.0.0] - 2026-07-10

First release: a topic, a detailed script, a scenes JSON file or an article URL becomes a narrated,
subtitled motion-graphics video, with a scene-approval gate, multi-provider TTS, word-accurate
subtitles, thumbnails and SEO metadata.

[Unreleased]: https://github.com/tuila1freelancer/ai-video-studio/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/tuila1freelancer/ai-video-studio/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/tuila1freelancer/ai-video-studio/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/tuila1freelancer/ai-video-studio/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/tuila1freelancer/ai-video-studio/releases/tag/v1.0.0
