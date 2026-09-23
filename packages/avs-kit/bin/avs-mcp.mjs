#!/usr/bin/env node
// The MCP entry point an agent host spawns.
//
//   claude mcp add avs -- npx -y avs-mcp --url http://127.0.0.1:8123 --token avs_…
//
// Configuration comes from flags or the environment (AVS_URL, AVS_TOKEN, AVS_CHANNEL). stdout is
// the protocol channel and carries nothing else — anything worth saying goes to stderr.
import { parseArgs } from 'node:util';
import { AvsClient } from '../src/sdk.js';
import { createMcpServer } from '../src/mcp-server.js';

const { values } = parseArgs({
  strict: false,
  options: { url: { type: 'string' }, token: { type: 'string' }, channel: { type: 'string' } },
});

const avs = new AvsClient({ url: values.url, token: values.token, channel: values.channel });
const server = createMcpServer(avs, { name: 'avs', version: '1.0.0' });
process.stderr.write(`avs-mcp → ${avs.base}${avs.channel ? ` (channel ${avs.channel})` : ''}\n`);
server.listen();
