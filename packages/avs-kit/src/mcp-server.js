// A Model Context Protocol server over stdio, written out rather than pulled in.
//
// MCP on stdio is newline-delimited JSON-RPC 2.0 with four methods that matter: initialize,
// tools/list, tools/call and ping. That is small enough to own, and owning it keeps the kit at zero
// dependencies — which is the difference between "npx avs-mcp" and asking someone to install a tree
// of packages next to their agent.
//
// Everything an agent needs to know is in the tool descriptions; everything it must not know stays
// in the engine.
import { AvsError } from './errors.js';
import { tools as buildTools } from './mcp-tools.js';

const PROTOCOL_VERSION = '2025-06-18';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * @param {import('./sdk.js').AvsClient} avs
 * @param {{name?:string, version?:string}} [info]
 */
export function createMcpServer(avs, { name = 'avs', version = '1.0.0' } = {}) {
  const list = buildTools(avs);
  const byName = new Map(list.map((t) => [t.name, t]));

  /** One request in, one response out (or null for a notification). */
  async function handle(msg) {
    const { id = null, method, params } = msg || {};
    if (method === 'initialize') {
      return rpcResult(id, {
        // Echo the client's version when it speaks one we can: the tool surface is the same either way.
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version },
        instructions: [
          'AI Video Studio. Read a verdict before publishing and branch on reasons[].code, never on the words.',
          'Always pass clientRef when creating a video: a retry with the same reference cannot create a second one.',
          'Name the channel explicitly when the installation has more than one.',
          'avs_journal_tail is a cursor: keep lastId and pass it back; nothing is missed between calls.',
        ].join(' '),
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return null;
    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: list.map(({ name: n, description, inputSchema }) => ({ name: n, description, inputSchema })),
      });
    }
    if (method === 'tools/call') {
      const tool = byName.get(params?.name);
      if (!tool) return rpcError(id, -32602, `unknown tool ${params?.name}`);
      try {
        const out = await tool.run(params?.arguments || {});
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // A refusal is a RESULT, not a transport error: the agent should read the code and decide,
        // not see its tool call fail with no way to tell why.
        const body = e instanceof AvsError
          ? { error: e.message, code: e.code, status: e.status, retryable: e.retryable }
          : { error: String(e?.message || e), code: 'kit_error' };
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError: true });
      }
    }
    if (id === null || id === undefined) return null;
    return rpcError(id, -32601, `method not found: ${method}`);
  }

  /** Read newline-delimited JSON from a stream, answer on another. */
  function listen(input = process.stdin, output = process.stdout) {
    let buffer = '';
    input.setEncoding('utf8');
    input.on('data', async (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        let msg;
        try { msg = JSON.parse(text); } catch { output.write(`${JSON.stringify(rpcError(null, -32700, 'parse error'))}\n`); continue; }
        const reply = await handle(msg);
        if (reply) output.write(`${JSON.stringify(reply)}\n`);
      }
    });
  }

  return { handle, listen, tools: list };
}
