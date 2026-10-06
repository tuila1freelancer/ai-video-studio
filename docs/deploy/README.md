# Running AI Video Studio as a server

Two shapes, same engine. Pick by where the work should happen, not by which sounds more modern.

| | **A — the owner's Mac** | **B — a container** |
|---|---|---|
| What runs | the built `.app`, or `npm start` behind a launch agent | `avs:latest` from this repository's Dockerfile |
| Source exposure | none: it never leaves the machine | encrypted bytecode only; the key is inside a compiled launcher |
| Voices, fonts, Chrome | macOS `say`, the machine's fonts, Chrome for Testing | Edge/paid TTS only, Noto faces, Chromium |
| Best for | one owner, several channels, agents on the same machine or over Tailscale | a VPS, or handing the engine to someone else to host |

Both are driven the same way: `AVS_MODE=server`, a bearer token per agent, and the kit
(`packages/avs-kit`). The contract is in [`docs/agent`](../agent/README.md).

There is a third shape that needs no deployment at all: **the installed app on the owner's own
machine**. AI Setting → Agent (MCP) turns on the same token check on loopback, mints the token and
prints the command; the kit travels inside the bundle and finds the app by itself. That is the right
answer for one person with agents on their own machine, and it is what the customer-facing manual
describes. Use a server shape when the engine has to outlive a laptop lid or be reached by somebody
else.

---

## A. On a Mac

```bash
npm run shell:build:dist          # or run from the repo with npm start
export AVS_MODE=server
export AVS_HOST=127.0.0.1         # 0.0.0.0 only behind Tailscale or a reverse proxy
npm run token -- create --name claude --scopes read,produce,publish
npm start
```

Keep it running with a LaunchAgent (macOS) or a systemd unit (Linux). Reach it from another machine
over **Tailscale** rather than by opening a port: the API has one credential and no rate limiting,
and it is not meant to face the open internet.

## B. In a container

```bash
export AVS_APP_KEY=$(openssl rand -hex 32)        # the payload's encryption key, per build
DOCKER_BUILDKIT=1 docker build \
  --secret id=appkey,env=AVS_APP_KEY \
  --build-arg BUILD_ID=$(date +%s) \
  -t avs:latest .

docker run -d --name avs \
  -p 127.0.0.1:8123:8123 \
  -v avs-data:/data \
  avs:latest

docker logs avs | grep 'API token'   # the first token, printed once — then mint your own and revoke it
```

`BUILD_ID` is not decoration: a BuildKit secret's value is not part of the cache key, so a rebuild
with a new key would reuse the bytecode layer encrypted with the old one and the image would refuse
to decrypt itself. Pass a fresh one every build.

**`/data` must be a real volume.** It holds the database, the API tokens and every project. A
container without it is an empty installation to the owner on every restart.

Verify what shipped, not what the Dockerfile meant to ship:

```bash
node scripts/audit-image.mjs --image avs:latest
```

### What the container cannot do

- **macOS `say`** — there is no offline voice. A channel must use Edge or a paid provider.
- **Whisper** — not installed; subtitle `engine: 'estimate'` or `'align'` with a model mounted in.
- **Opening a folder** — `/channels/:id/open` and `/projects/:id/open` answer `501 headless` with the
  path instead, which is what a remote caller wanted anyway.

### Fonts

The image installs `fonts-noto-core`, `fonts-noto-cjk` and `fonts-noto-color-emoji`, and the
per-language subtitle table names those faces on Linux. Without them fontconfig substitutes
**silently** and the burned video ships in a typeface nobody chose — so if you slim the image, check
a Japanese or Korean render before believing it.

---

## Operating either one

| Task | How |
|---|---|
| Give an agent access | `npm run token -- create --name <agent> --scopes read,produce[,publish] [--channels ch_x]` |
| Take it away | `npm run token -- revoke <id>` (the row stays, so the history still reads) |
| Stop new work before a deploy | `POST /api/ops/drain`, wait for `ops.state: paused`, then restart |
| Resume | `POST /api/ops/resume` |
| See what happened | `GET /api/events?after=<id>`, or `avs journal tail --follow` |
| What it is spending | `GET /api/usage`; caps in `GET /api/settings` → `budget` |
| Back up | stop or drain, then copy `$AVS_DATA_DIR` (or `docker run --rm -v avs-data:/data -v $PWD:/out alpine tar czf /out/avs-data.tgz /data`) |
| Restore | put the directory back and start; the schema migrates itself forward |
| Upgrade | drain → new image or new build → start. Migrations run at boot and back the database up first |

### When something is wrong

1. `GET /api/health` — `ok`, `mode`, `ops`, and which dependencies resolved.
2. `docker logs avs` / `$AVS_DATA_DIR/logs/app.log` — the rotating server log.
3. `GET /api/projects/:id/diagnostics` — for one video: deps, masked config, QC, jobs, the last error.
4. `degraded` in `/api/health` means the process survived an uncaught error and its in-memory state
   may no longer match the database: drain and restart when convenient.

### The honest limits

- A token is a bearer credential: anyone holding it can do what its scopes allow. Mint one per agent,
  bind it to a channel, and rotate it when an agent is retired.
- The engine has no rate limiting and no audit of reads. It is built for the owner's own machines,
  not for the public internet — put it behind Tailscale, a VPN or an authenticating proxy.
- Encrypted bytecode raises the cost of reading the source; it does not make it impossible. The key
  is inside the launcher, and anything running on someone else's machine can be disassembled. If the
  doctrine itself must never leave, it has to stay on a machine you control — model A, or the
  doctrine service recorded in `ENGINEERING.md`.
