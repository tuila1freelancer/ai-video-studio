# avs-kit

The agent-facing half of AI Video Studio: an MCP server, a CLI and an SDK. No dependencies, and no
doctrine — everything here is a thin wrapper over the engine's HTTP API, which is why this can be
read by anyone while the engine stays closed.

```bash
# MCP host (Claude Code, Claude Desktop, …)
claude mcp add avs -- node bin/avs-mcp.mjs --url http://127.0.0.1:8123 --token avs_…

# command line
AVS_URL=http://127.0.0.1:8123 AVS_TOKEN=avs_… node bin/avs.mjs video create --topic "…" --start --wait
node bin/avs.mjs video verdict <id> && node bin/avs.mjs video publish <id>

# from code
import { AvsClient } from './src/sdk.js';
const avs = new AvsClient({ url, token, channel });
const { project } = await avs.createProject({ topic: '…', clientRef: 'run-1' });
await avs.startProject(project.id);
const done = await avs.waitFor(project.id);
const verdict = await avs.verdict(done.id);
```

Configuration: `AVS_URL`, `AVS_TOKEN`, `AVS_CHANNEL` (or `--url`, `--token`, `--channel`).

CLI exit codes: `0` fine · `2` the verdict refused · `3` configuration · `4` temporary, retry ·
`5` budget or quota.

The contract, the error codes and the playbooks live in [`docs/agent`](../../docs/agent/README.md).
