// The OpenAPI document, assembled from the operation table.
//
// An agent should not have to be told what this API is; it should be able to read it. The document
// is built at request time from one source, so it cannot drift from the scope map or the error
// vocabulary — and a test proves every path in it is a path the router actually mounts.
import { requiredScope } from '../scopes.js';
import { SCHEMAS } from './schemas.js';
import { OPERATIONS } from './operations.js';

const jsonBody = (schema) => ({ required: true, content: { 'application/json': { schema } } });
const jsonReply = (schema) => ({ description: 'OK', content: { 'application/json': { schema: schema || { type: 'object' } } } });
const errorReply = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });

/** OpenAPI writes `{id}`; Express writes `:id`. The table is written the OpenAPI way. */
export const toExpressPath = (p) => p.replace(/\{(\w+)\}/g, ':$1');

export function buildOpenApi({ version = '0.0.0', serverUrl = '/api' } = {}) {
  const paths = {};
  for (const [key, op] of Object.entries(OPERATIONS)) {
    const [method, path] = key.split(' ');
    const scope = requiredScope(method, toExpressPath(path));
    const params = [
      ...(path.match(/\{(\w+)\}/g) || []).map((seg) => ({
        name: seg.slice(1, -1), in: 'path', required: true, schema: { type: 'string' },
      })),
      ...(op.query || []),
    ];
    paths[path] = paths[path] || {};
    paths[path][method.toLowerCase()] = {
      summary: op.summary,
      tags: op.tags,
      // What this call needs from a token, stated rather than discovered by being refused.
      'x-avs-scope': scope,
      ...(params.length ? { parameters: params } : {}),
      ...(op.body ? { requestBody: jsonBody(op.body) } : {}),
      responses: {
        200: jsonReply(op.reply),
        ...(scope ? { 401: errorReply('token_required'), 403: errorReply('scope_denied or license_required') } : {}),
        ...(op.codes?.length ? { default: errorReply(`Known codes: ${op.codes.join(', ')}`) } : {}),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'AI Video Studio',
      version,
      description: [
        'Agent-facing API. Branch on the `code` field of an error, never on its prose.',
        'In server mode every call carries `Authorization: Bearer avs_…`; scopes are read, produce, publish, admin.',
        'Name the channel explicitly (body.channelId, ?channel= or X-AVS-Channel) — the active channel is only a default.',
        'Send an Idempotency-Key (or clientRef on a create) so a retry after a timeout cannot spend twice.',
        'Poll GET /events?after=<id> for progress; a WebSocket at /ws carries the same feed live.',
      ].join('\n'),
    },
    servers: [{ url: serverUrl }],
    components: {
      schemas: SCHEMAS,
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Mint with `npm run token -- create` on the machine running the server.' } },
    },
    security: [{ bearer: [] }],
    paths,
  };
}
