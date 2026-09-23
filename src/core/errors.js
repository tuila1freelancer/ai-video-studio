// Error taxonomy — classify a pipeline failure so the orchestrator can pick the right
// reaction: transient errors earn the one macro auto-resume (P10), deterministic
// config/resource errors surface immediately with an actionable message instead of
// burning a full resume + 8s on a retry that cannot succeed.
//
// Classes:
//   transient  — network blips, timeouts, 5xx, unknown → keep exactly ONE auto-resume
//   rate-limit — provider throttling; clears with time → auto-resume still helps
//   config     — deterministic: bad/missing key, no voice picked, invalid input → user must act
//   resource   — machine-level: missing binary, disk full, permissions → user must act
//
// A CODE decides the class where the error carries one, and the text patterns are only the
// fallback for errors this app did not raise — node's ENOENT, a provider's 403, a library's
// timeout. That order is the whole point: the patterns used to include Vietnamese substrings
// ('chưa cấu hình', 'không tìm thấy ffmpeg'), so translating a message would have silently
// reclassified a config error as transient and bought it a pointless auto-resume.

import { t } from '../i18n/t.js';

/** The class each code belongs to. A code not listed here is transient, like any unknown. */
export const ERROR_CLASS = {
  'config.no-llm': 'config',
  'config.no-key': 'config',
  'config.no-voice': 'config',
  'config.bad-input': 'config',
  'config.empty-catalog': 'config',
  'script.audit-failed': 'config',
  'budget.exceeded': 'config',
  'resource.no-binary': 'resource',
  'resource.disk': 'resource',
  'rate-limit': 'rate-limit',
};

/**
 * Attach a stable class code to an error, so its classification never depends on its wording.
 * @template {Error} E @param {E} err @param {keyof ERROR_CLASS} code @returns {E}
 */
export function coded(err, code) {
  err.appCode = code;
  return err;
}

/** `throw failed('config.no-key', 'LarVoice: …')` — the common case in one call. */
export function failed(code, message) {
  return coded(new Error(message), code);
}

const RATE_LIMIT = /\b429\b|rate.?limit|too many requests/i;
// Third-party wording only. Anything this app raises itself carries a code instead.
const CONFIG = new RegExp([
  'LLM not configured', '\\b40[13]\\b', 'invalid[_ ]?api[_ ]?key', 'incorrect api key',
  'project not found',
].join('|'), 'i');
const RESOURCE = new RegExp([
  'ENOENT', 'ENOSPC', 'EACCES', 'EPERM', 'spawn .* ENOENT',
  'ffmpeg exit 127', 'chrome.*not.*(found|available)', 'no space left', 'disk full',
].join('|'), 'i');

/** The hint key for a class — resolved to the owner's language at the point it is shown. */
const HINT_KEY = {
  'rate-limit': 'error.hint.rateLimit',
  resource: 'error.hint.resource',
  config: 'error.hint.config',
  transient: 'error.hint.transient',
};

/**
 * @param {Error|string} err
 * @returns {{cls:'transient'|'rate-limit'|'config'|'resource', retryable:boolean, hint:string, hintKey:string, code:string|null}}
 *   hint is the actionable line shown to the user, in the interface language.
 */
export function classifyError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.appCode || null;
  const cls = ERROR_CLASS[code]
    || (RATE_LIMIT.test(msg) ? 'rate-limit'
      : RESOURCE.test(msg) ? 'resource'
        // unknown defaults to transient so a misclassification can never SUPPRESS a helpful resume
        : CONFIG.test(msg) ? 'config' : 'transient');
  return {
    cls,
    retryable: cls === 'transient' || cls === 'rate-limit',
    hintKey: HINT_KEY[cls],
    hint: t(HINT_KEY[cls]),
    code,
  };
}
