// A stable machine word for every refusal the API makes.
//
// The sentences are for the owner and are translated on the way out; an agent must not branch on
// prose in any language. Rather than rewrite 178 handlers, the code is derived at the edge from
// what they already return: the few messages worth naming precisely are listed here — keyed by the
// Vietnamese text, which is how this codebase has always keyed a server string — and everything
// else falls back to its HTTP status, so every error carries a code even when nobody named one.

/** Named refusals: the ones an agent is expected to handle differently, not just report. */
const BY_MESSAGE = new Map(Object.entries({
  'not found': 'not_found',
  forbidden: 'forbidden',
  license_required: 'license_required',
  token_required: 'token_required',
  scope_denied: 'scope_denied',
  'dự án không ở bước duyệt cảnh': 'gate_not_at_scenes',
  'video chưa render xong': 'video_not_ready',
  'chưa kết nối OAuth — vào Cài đặt → Đăng video': 'publish_not_connected',
  'không có chủ đề hợp lệ': 'input_no_topic',
  'gợi ý không tồn tại': 'suggestion_not_found',
  'project not found': 'not_found',
}));

/** What a status alone says, when the message is one nobody has named yet. */
const BY_STATUS = {
  400: 'bad_request',
  401: 'token_required',
  402: 'payment_required',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
  500: 'internal',
  501: 'not_implemented',
  503: 'unavailable',
};

/**
 * The code for a refusal.
 * @param {string} message the UNTRANSLATED message the route produced
 * @param {number} status
 */
export function codeFor(message, status) {
  const named = BY_MESSAGE.get(String(message || '').trim());
  if (named) return named;
  return BY_STATUS[status] || (status >= 500 ? 'internal' : 'request_failed');
}

/** Attach a code to a thrown error, so a handler can name its own refusal. */
export function apiError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.expose = true;
  return err;
}
