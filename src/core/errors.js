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

const RATE_LIMIT = /\b429\b|rate.?limit|too many requests/i;
const CONFIG = new RegExp([
  'LLM not configured', 'chưa cấu hình', 'Chưa chọn voice', 'chưa nhập API key',
  '\\b40[13]\\b', 'invalid[_ ]?api[_ ]?key', 'incorrect api key', 'key bị từ chối',
  'không có chủ đề hợp lệ', 'project not found', 'catalog trống',
].join('|'), 'i');
const RESOURCE = new RegExp([
  'ENOENT', 'ENOSPC', 'EACCES', 'EPERM', 'spawn .* ENOENT',
  'không tìm thấy ffmpeg', 'ffmpeg exit 127', 'chrome.*not.*(found|available)',
  'no space left', 'disk full',
].join('|'), 'i');

/**
 * @param {Error|string} err
 * @returns {{cls:'transient'|'rate-limit'|'config'|'resource', retryable:boolean, hint:string}}
 *   hint is the actionable Vietnamese line shown to the user (UI text stays Vietnamese).
 */
export function classifyError(err) {
  const msg = String(err?.message || err || '');
  if (RATE_LIMIT.test(msg)) {
    return { cls: 'rate-limit', retryable: true, hint: 'Nhà cung cấp đang giới hạn tần suất — hệ thống sẽ tự chờ và chạy tiếp.' };
  }
  if (RESOURCE.test(msg)) {
    return { cls: 'resource', retryable: false, hint: 'Lỗi tài nguyên máy (thiếu binary/đầy đĩa/quyền truy cập) — kiểm tra ffmpeg/Chrome/dung lượng đĩa rồi bấm Tiếp tục.' };
  }
  if (CONFIG.test(msg)) {
    return { cls: 'config', retryable: false, hint: 'Lỗi cấu hình (API key/giọng đọc/đầu vào) — mở Cài đặt để sửa rồi bấm Tiếp tục. Chạy lại tự động sẽ không giúp ích.' };
  }
  // unknown defaults to transient so a misclassification can never SUPPRESS a helpful resume
  return { cls: 'transient', retryable: true, hint: 'Lỗi tạm thời — hệ thống tự chạy tiếp.' };
}
