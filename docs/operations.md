# Build, release and operations

## Build and release

```bash
npm run shell:build          # dev .app pointing at this checkout
npm run shell:build:dist     # release .app — bundled, bytecode-compiled, encrypted
npm run win:build            # Windows NSIS installer
npm run release -- --version 1.1.0
```

`scripts/release.mjs` runs: bump the version → build the `.app` → move the sourcemap out of the
payload → `audit-release.mjs` → codesign → zip with checksum → notarise and staple. The artefact
lands in `dist/`; there is nothing to sign in to and nothing to upload it to.

The macOS release contains no readable source: `src/server.js` is bundled by esbuild, compiled to V8
cached data, AES-256-GCM encrypted, and loaded by `loader.cjs`, which verifies the V8 build, the
flags and a SHA-256 before V8 sees the bytes and refuses rather than falling back. The key is
generated per build and passed over stdin. Windows ships the same chain: the payload is encrypted
bytecode in `resources/app-payload`, and the key lives inside a compiled Go launcher
(`shell/win-launcher`) that hands it to the vendored `node.exe` over stdin — Electron never sees it.
Both bundles also carry `packages/avs-kit` as readable source, which is the point of it.

The interface ships as `js/main-[hash].js` plus `js/chunks/*-[hash].js` (code-split, so lazy
screens stay lazy), one minified `css/app-[hash].css`, and the document assembled from its partials
with preload hints for the entry's static graph. Every hashed file is served `immutable`; the
document is revalidated by ETag. `AVS_PUBLIC_DIR` points the dev server at a built payload.

Supporting scripts: `fetch-node.mjs` (checksum-verified runtime) · `build-fonts.mjs` (font pipelines
under a byte budget) · `build-libs.mjs` · `build-whisper-model.mjs` · `build-icon.mjs` ·
`build-frontend.mjs` · `build-locales.mjs` and four `i18n-extract-*` tools.

## Operations

| | Location |
|---|---|
| Database | `data/studio.sqlite` (WAL), backups in `data/backups/` |
| Projects | `data/projects/<id>/{audio,srt,html,render,assets,output}` |
| Library | `data/library/{brand,bgm,sfx,fonts}` |
| Release data dir | `~/Library/Application Support/AI Video Studio` |
| Per-run journal | the in-app journal panel, and the `journal_events` table |
| All jobs | the Tasks view — every queued, running and recent job |

Diagnosis starts in the journal: grouped by stage with measured durations, scene-linked lines,
retries and errors, searchable and exportable. A red dependency chip means FFmpeg or Chrome is
missing. A run sitting at `scenes` or `review` is a gate, not a crash. Why a video did not update is
answered by the concat tier printed in the log. A project produced in the wrong language can be
repaired with `scripts/repair-language.mjs`.

## Running it for agents

The app is a desktop app by default and changes nothing about that. There are two ways to let an
agent in, and the first one needs no terminal at all.

**From the installed app.** AI Setting → **Agent (MCP)** → turn it on → mint a token. From that
moment every API call needs one, loopback included; the app's own window keeps working because the
launcher hands it a session of its own. The panel prints the exact `claude mcp add` line for that
machine — the bundled Node, the bundled kit — and the caps beside it are what stops a bad loop
spending all night. Both bundles ship `packages/avs-kit`, and the kit finds the running app by
reading `server.url` from its data directory, so nothing pins a port that changes every launch.

**As a server.** `AVS_MODE=server` opens the other shape: tokens are required from boot, there is no
window to authenticate, and tokens are minted on the machine — the HTTP route refuses outright.

```bash
npm run token -- create --name my-agent --scopes read,produce,publish   # mint one per agent
AVS_MODE=server AVS_HOST=127.0.0.1 npm start                          # 0.0.0.0 only behind Tailscale
claude mcp add avs -- node packages/avs-kit/bin/avs-mcp.mjs --token avs_…
```

Either way an agent gets the same thing: an explicit channel on every creation, machine-readable
error codes, a durable event cursor, a publish verdict, spending caps and a stop valve.

- The contract an agent reads: [`docs/agent/README.md`](agent/README.md) and
  `GET /api/openapi.json` · the playbooks are in `docs/agent/playbooks/`.
- The kit (MCP server, `avs` CLI, SDK — no dependencies): [`packages/avs-kit`](../packages/avs-kit/README.md).
- Deploying it, on a Mac or in a container: [`docs/deploy/README.md`](deploy/README.md).
- Shipping a build: [`docs/release/checklist.md`](release/checklist.md) — and note that the
  Windows installer has not yet been run on Windows.

---
