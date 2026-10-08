<div align="center">

# AI Video Studio

**Turn one line of text into a finished, narrated, motion-graphics video.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](.nvmrc)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[Quick start](#quick-start) · [Features](#features) · [How it works](#how-it-works) ·
[Documentation](#documentation) · [Contributing](#contributing) · [Support](#support-the-project)

</div>

---

AI Video Studio is a local-first video production engine. Give it a topic, a detailed script, a
scenes JSON file or an article URL, and it writes the script, designs every scene as animated
HTML, records the narration, times the subtitles to the spoken words, renders, mixes and masters
the result — then writes the title, description, chapters and thumbnail to go with it.

It runs on your machine with your own provider keys. With none configured it still produces a
video, using an offline script writer and a keyless voice.

## Features

- **Four ways in** — a one-line topic, a detailed script (light polish only, ≥ 90 % of your wording
  kept), a validated scenes JSON file (zero LLM calls), or an article URL used as research.
- **Art-directed motion graphics** — every scene is a GSAP timeline generated against its own
  narration, rendered frame by frame in headless Chrome. A frame is a pure function of time, so
  renders are deterministic and memory stays flat at any length.
- **Narration and subtitles** — eleven TTS providers from free and offline to premium, one locked
  voice per video, karaoke captions timed by forced alignment, and 30 subtitle style controls with
  a live preview through the real burn path.
- **Thirteen languages** for both the videos and the interface, including Chinese, Japanese and
  Thai segmentation, per-script typography, dubbing and subtitle export without re-rendering.
- **Review before you spend** — an optional scene gate shows the storyboard and the exact TTS cost
  before any voice credit is used; an optional review gate approves scenes one by one.
- **Incremental rebuilds** — content hashes mean editing one scene re-renders only that scene, and
  the final join picks the cheapest of four tiers (`skip`, `audio`, `copy`, `encode`).
- **Edit your own footage** — add motion graphics to an existing video, with optional silence
  removal and auto-zoom.
- **Publishing** — SEO metadata with YouTube chapters, A/B thumbnails, six platform cover sizes,
  and direct upload to YouTube and Facebook Pages, private or scheduled by default.
- **Channels and an assistant** — per-channel brand kit, voice and settings; a topic assistant,
  a content calendar and batch production.
- **Built for automation** — an MCP server, a CLI and an SDK (`packages/avs-kit`), a generated
  OpenAPI document, scoped API tokens, spending caps and a pre-publish verdict.

## Quick start

**Requirements:** Node.js 22, FFmpeg, and Chrome or Chromium. whisper.cpp is optional and gives
word-accurate subtitle timing.

```bash
git clone https://github.com/tuila1freelancer/ai-video-studio.git
cd ai-video-studio
npm install
npm start
```

The server prints `AVS_READY <url>` (also written to `data/server.url`); open it in a browser.
No account and no configuration are required. Add LLM and voice provider keys in **AI Setting**
when you want them.

Without a terminal, double-click `run.command` (macOS) or `run-windows.bat` (Windows).

| Dependency | Used for | If it is missing |
|---|---|---|
| Node.js 22 | everything | nothing runs — `better-sqlite3` is built for Node 22 |
| FFmpeg + ffprobe | render, mix, probe | no video |
| Chrome / Chromium | scene rendering, thumbnails, caption measurement | no video |
| whisper.cpp + a `ggml-*.bin` model | word-accurate subtitles | timing falls back to an estimate |
| `pip install supertonic` | local neural TTS | that voice provider is unavailable |

`GET /api/health` reports which dependencies were found. Each can be pointed at explicitly with an
`AVS_*` environment variable (`AVS_FFMPEG`, `AVS_CHROME`, `AVS_WHISPER`, …); otherwise the standard
install locations, `vendor/` and `PATH` are searched.

## How it works

```
  input ──► script ──► editorial ──► duration fit ──► timing estimate
                                                            │
      ┌─────────────────────────────────────────────────────┘
      ▼
  scenes ──► ⟨scene gate⟩ ──► voice + subtitles ──► render ──► ⟨review gate⟩
                                                            │
      ┌─────────────────────────────────────────────────────┘
      ▼
  join + mix ──► quality check ──► metadata ──► publish ──────────► MP4
```

Scenes are built before the voice, so the storyboard can be reviewed before any TTS credit is
spent. Both gates are optional holds: the run stops at its own status and waits.

Every input converges on one artifact — `{ thumbnail{title,prompt}, scenes[{stt, voice, visual,
assets}] }` — saved as `scenes.json` per project. The output is one MP4 mastered to −16 LUFS, plus
subtitle tracks in any of the thirteen languages, thumbnails, platform covers, SEO metadata, a
quality report and a per-run processing journal.

The stage-by-stage breakdown, the source layout and the rules the code enforces are in
[`docs/architecture.md`](docs/architecture.md).

## Automation and agents

The app is a desktop tool by default. Two ways let an agent drive it:

- **From the app** — AI Setting → **Agent (MCP)** → turn it on and mint a token. The panel prints
  the exact command to register the bundled MCP server with your agent.
- **As a server** — `AVS_MODE=server` requires a token on every request; tokens are minted on the
  machine with `npm run token`.

```bash
npm run token -- create --name my-agent --scopes read,produce,publish
AVS_MODE=server AVS_HOST=127.0.0.1 npm start
```

Agents get explicit channel selection, machine-readable error codes, a durable event cursor,
a pre-publish verdict, spending caps and a stop valve. Start with
[`docs/agent/README.md`](docs/agent/README.md).

## Documentation

| Topic | Where |
|---|---|
| Pipeline, source layout, invariants | [`docs/architecture.md`](docs/architecture.md) |
| LLM, voice and other providers; configuration; cost | [`docs/providers.md`](docs/providers.md) |
| Languages and translation | [`docs/languages.md`](docs/languages.md) |
| Build, release and operations | [`docs/operations.md`](docs/operations.md) |
| Deploying on a Mac or in a container | [`docs/deploy/README.md`](docs/deploy/README.md) |
| Agent contract, playbooks and the kit | [`docs/agent/README.md`](docs/agent/README.md) · [`packages/avs-kit`](packages/avs-kit/README.md) |
| Performance measurements | [`docs/performance.md`](docs/performance.md) |
| Protected behaviours and decision records | [`ENGINEERING.md`](ENGINEERING.md) |
| Release checklist | [`docs/release/checklist.md`](docs/release/checklist.md) |

An in-app manual covering every screen is available under **Hướng dẫn** (Guide).

## Development

```bash
npm run dev           # restart on change
npm test              # ~900 tests, hermetic, no network
npm run lint          # ESLint 9 flat config
npm run test:smoke    # every scene template built in 16:9 and 9:16
npm run test:e2e      # boot, produce a short video, verify the MP4
npm run perf:boot     # measure the cost of the first paint
```

CI runs lint and the test suite on every push to `main` and on every pull request.

## Known limitations

- **No right-to-left scripts.** Karaoke captions render one element per word, which breaks Arabic
  letter joining.
- **Some runtime messages stay in Vietnamese.** Strings assembled at runtime appear in the journal
  and logs untranslated; the interface itself is fully translated.
- **Scene generation costs one LLM call per scene**, which dominates the cost of long videos.
- **The Windows build is built and audited on macOS** but has not yet been verified end to end on
  Windows — see the [release checklist](docs/release/checklist.md).

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development
setup and conventions, and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues
privately as described in [`SECURITY.md`](SECURITY.md). Notable changes are listed in
[`CHANGELOG.md`](CHANGELOG.md).

## Support the project

AI Video Studio is free and open source. If it saves you time, you can help keep it maintained.

<!-- International sponsorship: uncomment once the accounts exist (and the matching lines in .github/FUNDING.yml).
<a href="https://github.com/sponsors/tuila1freelancer"><img src="https://img.shields.io/badge/Sponsor%20on%20GitHub-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
<a href="https://ko-fi.com/YOUR_KOFI_USERNAME"><img src="https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
-->

**Bank transfer from Vietnam (VietQR)** — scan with any Vietnamese banking app; MoMo and ZaloPay
read VietQR too.

<p>
  <img src="docs/images/donate-vietqr.png" alt="VietQR — Sacombank 060316270371" width="220">
</p>

| | |
|---|---|
| Bank | Sacombank |
| Account number | `060316270371` |
| Account holder | NGUYEN VO SONG TOAN |
| Transfer note | AI Video Studio |

Starring the repository and reporting bugs help just as much.

## License

[MIT](LICENSE) © 2026 TuiLa1Freelancer.

Parts of the scene-rendering guidance are adapted from
[HyperFrames](https://github.com/heygen-com/hyperframes) (Apache License 2.0). Third-party notices
are in [`NOTICE.md`](NOTICE.md).
