# Contributing to AI Video Studio

Thanks for taking the time to contribute. This guide covers how to set up a development
environment, the checks every change has to pass, and the conventions the codebase relies on.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues
are handled privately — see [SECURITY.md](SECURITY.md) instead of opening an issue.

## Ways to contribute

- **Report a bug** with the [bug report form](../../issues/new?template=bug_report.yml). The most
  useful reports include the processing journal of the failed run (Studio → Journal → Download).
- **Propose a feature** with the [feature request form](../../issues/new?template=feature_request.yml).
  For anything larger than a small fix, please open an issue first so the approach can be agreed
  before you spend time on it.
- **Improve a translation.** Interface catalogues live in `public/locales/`; see
  [Interface text and translations](#interface-text-and-translations).
- **Send a pull request** — see below.

## Development setup

### Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x | Pinned in `.nvmrc`. `better-sqlite3` is a native module built for Node 22; a different major version will fail to load it. |
| FFmpeg + ffprobe | 6 or newer | Rendering and probing. On macOS: `brew install ffmpeg`. |
| Chrome or Chromium | any recent | Scene rendering and thumbnails. |
| whisper.cpp | optional | Word-accurate subtitle timing. `brew install whisper-cpp`, then `npm run whisper:build` for a model. |

With nvm, `nvm use` picks up `.nvmrc`. Alternatively `npm run node:fetch` downloads a
checksum-verified portable Node 22 into `vendor/node/` (the release builds bundle it), and you can
run any script with `vendor/node/bin/node`.

### First run

```bash
git clone https://github.com/tuila1freelancer/ai-video-studio.git
cd ai-video-studio
npm install
npm run dev        # restarts on change; prints AVS_READY <url>
```

Open the printed URL. No account or API key is needed to start: without an LLM key the app uses
its offline script path and the system voice. Provider keys are added in **AI Setting**.

Data lives in `data/` (git-ignored). Point `AVS_DATA_DIR` elsewhere to keep a scratch installation
separate from your real one.

## Checks

Every pull request must pass the same checks CI runs:

```bash
npm run lint
npm test                 # ~900 tests, no network, under a minute
npm run test:smoke       # builds every scene template in 16:9 and 9:16, no browser needed
```

Use Node 22 (`vendor/node/bin/node --test --test-timeout=120000 "tests/*.test.js"` if your default
Node differs). One further check needs a local Chrome and FFmpeg, and is run
before a release rather than on every change:

```bash
npm run test:e2e         # boots the server, produces one short video, verifies the MP4
```

## Conventions

### Code

- **ES modules, Node 22, no build step for the server.** The interface is plain ES modules served
  as-is in development and bundled by `scripts/build-frontend.mjs` for releases.
- **Size limits.** Every file under `src/` and `public/js/` stays at or below 400 lines and every
  function at or below 120. When a module outgrows that, split it into a directory of the same name
  behind a facade at the old path, and add the mapping to `RELOCATED` in `tests/_source.mjs`.
- **Logging.** No `console.*` outside `src/util/log.js`; use the logger.
- **Comments** explain *why* — a constraint, a measurement, a trap — not what the next line does.
  Keep them short.
- `tests/code-health.test.js` enforces the size, logging and test-isolation rules.

### Protected behaviours

[`ENGINEERING.md`](ENGINEERING.md) lists behaviours that exist because something once went wrong.
You may move them, but if a change alters one, say so explicitly in the pull request and update
both the entry and its test.

### API routes

A new route needs, in the same commit:

1. an entry in `tests/fixtures/route-table.json` (kept sorted);
2. a summary in `src/api/spec/operations.js` (the OpenAPI document is generated from it — run
   `npm run openapi` to refresh `docs/agent/openapi.json`);
3. a scope rule in `src/api/scopes.js` if it is not an ordinary `produce` write.

A new router file is also added to `RELOCATED['src/api/routes.js']` in `tests/_source.mjs`.

### Interface text and translations

Vietnamese is the source language of every catalogue; the other twelve are generated from it and
checked mechanically for placeholders, markup and length.

- **Markup**: write the Vietnamese text in the partial, then `node scripts/i18n-extract.mjs --write`.
- **Toasts, dialogs and `m()` / `tp` strings**: `node scripts/i18n-extract-ui-msgs.mjs --write`.
- **Server messages**: `node scripts/i18n-extract-server.mjs --write`.
- **The in-app manual** (`public/guide/sections.json`): `node scripts/i18n-extract-guide.mjs`.
  Manual keys are positional — append new chapters at the end rather than inserting.
- Then `node scripts/build-locales.mjs` (add `--guide` for the manual) translates the missing keys
  with the LLM configured in AI Setting, and `node scripts/audit-i18n.mjs` must exit 0.

Changing an existing Vietnamese string in place leaves its translations stale: delete that key from
the twelve other catalogues before running `build-locales.mjs`.

A machine-readable error `code` needs no catalogue entry — keep the code in its own field and the
sentence in `error` / `message`.

### Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <imperative summary, lower case, no trailing period>

<body: what changed and why, wrapped at 72 columns>
```

Types in use: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `chore`. Keep each commit
to one logical change, and make sure it passes lint and tests on its own.

## Pull requests

1. Fork the repository and create a branch from `main` (`fix/subtitle-drift`, `feat/vtt-export`).
2. Make your change with tests. A bug fix should come with a test that fails without it.
3. Run `npm run lint` and `npm test`.
4. Add a line under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md) for anything user-visible.
5. Open the pull request and fill in the template. Keep it focused: unrelated clean-ups belong in
   a separate pull request.

A maintainer will review it. Expect questions — they are about the code, not about you.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
