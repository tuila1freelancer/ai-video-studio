// "Is there a newer version?" and "give me the file".
//
// Both answers come from the store using the licence key this machine is already activated with,
// so updating never sends anyone off to a browser to sign in. The check is cached for six hours:
// a release happens a handful of times a year and every installed copy asks.
import { logger } from '../util/log.js';
import { CHANNEL, PLATFORM, clientApiKey, configured, storeUrl } from './config.js';
import { deviceId } from './device.js';
import { LicenseClient, OfflineError } from './sdk.js';
import { appVersion } from './index.js';
import { readStore } from './store.js';

import { m, tp } from '../i18n/t.js';
const CHECK_TTL_MS = 6 * 60 * 60 * 1000;

let cache = null;

function client() {
  return new LicenseClient({ apiKey: clientApiKey(), baseUrl: storeUrl() });
}

/** `1.2.10` > `1.2.9`. Compares numerically per segment; unparseable parts sort as 0. */
export function isNewer(latest, current) {
  const parse = (v) => String(v || '').split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** @returns {Promise<{current, latest, changelog, hasUpdate, fileSize, checksum}>} */
export async function checkUpdate({ force = false } = {}) {
  const current = appVersion();
  if (!configured()) return { current, latest: null, changelog: null, hasUpdate: false };
  if (!force && cache && Date.now() - cache.at < CHECK_TTL_MS) {
    return { ...cache.result, current };
  }

  let latest = null;
  try {
    latest = await client().latestVersion({ platform: PLATFORM, channel: CHANNEL });
  } catch (e) {
    if (!(e instanceof OfflineError) && e?.status !== 404) {
      logger.warn(`không kiểm tra được bản cập nhật: ${e.message}`);
    }
    // No answer is not "no update" — do not cache it, so the next check tries again.
    return { current, latest: null, changelog: null, hasUpdate: false };
  }

  const result = {
    latest: latest?.version || null,
    versionId: latest?.id || null,
    changelog: latest?.changelog || null,
    fileSize: latest?.fileSize ?? null,
    checksum: latest?.checksum || null,
    hasUpdate: Boolean(latest?.version && isNewer(latest.version, current)),
  };
  cache = { at: Date.now(), result };
  return { ...result, current };
}

/** A short-lived URL for the newest build, for this licence and this device. */
export async function downloadUrl({ versionId } = {}) {
  const file = readStore();
  if (!configured() || !file.key) {
    const e = new Error(m('Cần kích hoạt license trước khi tải bản mới.'));
    e.statusCode = 403;
    throw e;
  }
  try {
    return await client().createDownload({
      licenseKey: file.key,
      deviceId: deviceId(),
      versionId,
      platform: PLATFORM,
      channel: CHANNEL,
    });
  } catch (e) {
    const err = new Error(
      e instanceof OfflineError
        ? m('Không kết nối được tới cửa hàng để lấy link tải.')
        : tp`Không lấy được link tải: ${e.message}`,
    );
    err.statusCode = e?.status || 502;
    throw err;
  }
}

/** Test seam. */
export function resetUpdateCache() {
  cache = null;
}
