# Agents

Two different jobs share this repository, and they need different things.

## An agent OPERATING the app (making videos, running a channel)

Read [`docs/agent/README.md`](docs/agent/README.md) first — the five rules, the life of a video and
the error codes — then the playbook for your job. The machine-readable contract is
`GET /api/openapi.json`.

Install the kit rather than writing HTTP by hand:

```bash
# MCP (Claude Code, Claude Desktop, any MCP host)
claude mcp add avs -- node packages/avs-kit/bin/avs-mcp.mjs --url http://127.0.0.1:8123 --token avs_…

# or the CLI, for cron and scripts
AVS_URL=… AVS_TOKEN=… node packages/avs-kit/bin/avs.mjs video create --topic "…" --start --wait
```

The rules that matter most, in one line each: name your channel, pass a `clientRef`, branch on
`code` and not on words, read the verdict before publishing, never `force`.

## An agent WORKING ON this repository (writing code)

`README.md` is the map; `ENGINEERING.md` records 45 protected behaviours that must not be re-broken
and how to re-point an anchor when code moves. Beyond that:

- **Node 22 only** — use `vendor/node/bin/node` for tests and builds (`better-sqlite3` is built for
  ABI 127; the system's Node 24 cannot load it).
- **Every file under `src/` and `public/js/` stays at 400 lines or fewer**, functions at 120, and
  `tests/code-health.test.js` enforces both. No `console.*` outside `src/util/log.js`.
- **A new route** must be added to `tests/fixtures/route-table.json` (sorted) in the same commit, and
  a new router to the list in `tests/_source.mjs`.
- **A new user-facing sentence** needs a catalogue entry: `node scripts/i18n-extract-server.mjs
  --write` then `node scripts/build-locales.mjs`. A machine-readable `code` needs none of that — keep
  the code in its own field and the sentence in `error`/`message`.
- **Run the suite before committing**: `vendor/node/bin/node --test --test-timeout=120000 "tests/*.test.js"`
  and `npm run lint`. Both are expected to be green, always.
