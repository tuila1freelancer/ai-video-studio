// What went wrong, in terms an agent can act on.
//
// The engine answers every refusal with a stable `code`; this turns that code into a decision:
// retry later, fix the configuration, stop spending, or tell the user. Nothing here parses prose.

export class AvsError extends Error {
  constructor(message, { code = 'request_failed', status = 0, body = null } = {}) {
    super(message);
    this.name = 'AvsError';
    this.code = code;
    this.status = status;
    this.body = body;
  }

  /** Worth sending again, unchanged, after a wait. */
  get retryable() {
    return RETRYABLE.has(this.code) || this.status >= 500 || this.status === 0;
  }

  /** The exit code a command should end with — the CLI's contract, in one place. */
  get exitCode() {
    if (this.code === 'verdict_failed') return 2;
    if (CONFIG.has(this.code) || this.status === 400) return 3;
    if (this.retryable) return 4;
    if (BUDGET.has(this.code)) return 5;
    return 1;
  }
}

const RETRYABLE = new Set(['rate_limited', 'internal', 'unavailable']);
const CONFIG = new Set([
  'token_required', 'scope_denied', 'channel_not_found', 'channel_denied',
  'not_found', 'bad_request', 'idempotency_key_reused', 'publish_not_connected',
]);
const BUDGET = new Set(['budget_exceeded', 'publish_quota_exhausted', 'publish_daily_cap']);

/** True when a refusal means "not now" rather than "not like this". */
export const isTemporary = (err) => err instanceof AvsError && (err.retryable || BUDGET.has(err.code));
