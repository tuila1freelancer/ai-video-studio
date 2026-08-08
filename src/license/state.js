// Is this copy of the app allowed to run right now?
//
// Pure: takes the licence file, the clock and this machine's id, returns a verdict. No disk, no
// network, no module state — which is what makes every branch below testable without a store.
//
// Four states, and the difference between them is what the UI does:
//   valid   — everything is fine
//   grace   — the subscription lapsed but the app still runs; nag, do not block
//   locked  — refused, with a reason worth showing
//   missing — no licence yet; ask for a key
import { isWithinGrace, verifyLicenseToken } from './sdk.js';

const DAY_MS = 86_400_000;

/**
 * How far the clock may move backwards before the app stops believing it.
 *
 * The token is verified against `Date.now()`, so winding the Mac's clock back would make an
 * expired licence look current. Anything beyond a day of backwards travel is treated as a lie and
 * forces an online check — small enough to catch the trick, large enough that a timezone change or
 * an NTP correction never trips it.
 */
const CLOCK_SLACK_MS = DAY_MS;

function daysUntil(target, now) {
  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - now.getTime()) / DAY_MS));
}

/**
 * @param {object}  input
 * @param {object}  input.file          contents of license.json
 * @param {string}  input.device        this machine's device id
 * @param {string}  input.publicKeyPem  key the token is verified against
 * @param {Date}    [input.now]
 */
export function licenseState({ file, device, publicKeyPem, now = new Date() }) {
  const stored = file || {};

  if (!stored.key) return { state: 'missing', reason: 'no-key' };

  // The store told us this licence is gone. That verdict outlives the token it was delivered
  // with, so it is checked before anything the token says.
  if (stored.status && stored.status !== 'active') {
    return { state: 'locked', reason: stored.status, key: stored.key };
  }

  if (!stored.token) return { state: 'missing', reason: 'no-token', key: stored.key };

  if (!publicKeyPem) {
    // No trust anchor means no verdict can be trusted either. A build that reaches this has been
    // released without its public key baked in, which is a build bug, not a customer problem.
    return { state: 'locked', reason: 'no-public-key', key: stored.key };
  }

  let claims;
  try {
    claims = verifyLicenseToken(stored.token, publicKeyPem);
  } catch (e) {
    return { state: 'locked', reason: e.reason || 'invalid-token', key: stored.key };
  }

  if (claims.deviceId && device && claims.deviceId !== device) {
    // The licence file was copied to another machine — or the logic board changed.
    return { state: 'locked', reason: 'device-mismatch', claims, key: stored.key };
  }

  if (stored.lastValidatedAt) {
    const last = new Date(stored.lastValidatedAt).getTime();
    if (Number.isFinite(last) && now.getTime() < last - CLOCK_SLACK_MS) {
      return { state: 'locked', reason: 'clock-rollback', claims, key: stored.key };
    }
  }

  const expired = claims.expiresAt ? new Date(claims.expiresAt).getTime() < now.getTime() : false;
  if (expired) {
    if (isWithinGrace(claims, now)) {
      return {
        state: 'grace',
        reason: 'expired',
        claims,
        key: stored.key,
        daysLeft: daysUntil(claims.graceUntil, now),
      };
    }
    return { state: 'locked', reason: 'expired', claims, key: stored.key };
  }

  return {
    state: 'valid',
    claims,
    key: stored.key,
    // Null for a lifetime licence: there is no countdown to show.
    daysLeft: daysUntil(claims.expiresAt, now),
  };
}

/** Everything in {valid, grace} may use the app. */
export function isRunnable(status) {
  return status?.state === 'valid' || status?.state === 'grace';
}

/** What the lock screen says. Vietnamese: this is user-facing. */
export const REASON_TEXT = {
  'no-key': 'Đăng nhập bằng tài khoản Google đã mua license để bắt đầu.',
  'no-token': 'License chưa được kích hoạt trên máy này. Đăng nhập để kích hoạt.',
  revoked: 'License này đã bị thu hồi. Liên hệ shop nếu bạn cho rằng đây là nhầm lẫn.',
  suspended: 'License này đang tạm ngưng. Kiểm tra lại tình trạng thanh toán.',
  expired: 'License đã hết hạn. Gia hạn để tiếp tục sử dụng.',
  'device-mismatch': 'License này được kích hoạt cho một máy khác. Hãy kích hoạt lại trên máy này.',
  'token-expired-offline': 'Cần kết nối mạng một lần để làm mới license.',
  'clock-rollback': 'Đồng hồ máy đang lệch về quá khứ. Chỉnh lại giờ hệ thống rồi làm mới license.',
  'invalid-signature': 'License token không hợp lệ. Hãy kích hoạt lại.',
  'invalid-token': 'License token không hợp lệ. Hãy kích hoạt lại.',
  malformed: 'License token không hợp lệ. Hãy kích hoạt lại.',
  'no-public-key': 'Bản cài đặt này thiếu khoá xác thực license. Hãy tải lại bản mới từ cửa hàng.',
};

export function reasonText(reason) {
  return REASON_TEXT[reason] || 'Không xác thực được license.';
}
