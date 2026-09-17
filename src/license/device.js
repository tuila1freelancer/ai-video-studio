// A stable name for this machine.
//
// The store counts devices, so this identifier decides whether reinstalling the app costs the
// customer a seat. It must survive an app reinstall, a rename of the Mac, and a new user account
// — which rules out the hostname (people rename laptops) and anything under the app's own data
// directory alone.
//
// macOS gives every machine a `IOPlatformUUID` that survives all of the above and changes only
// when the logic board does. That is the identifier; the random fallback exists only so a machine
// where `ioreg` is unavailable still gets a stable id rather than a new one every launch.
import { execFileSync } from 'node:child_process';
import { hostname, release } from 'node:os';
import { readStore, writeStore } from './store.js';
import { randomUUID } from 'node:crypto';

let cached = null;

function platformUuid() {
  try {
    const out = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

/** This machine's device id, as the store knows it. */
export function deviceId() {
  if (cached) return cached;
  const uuid = platformUuid();
  if (uuid) {
    cached = uuid;
    return cached;
  }
  // No ioreg (a stripped container, a future platform). Mint one and keep it next to the licence
  // so it is at least stable for this installation.
  const file = readStore();
  if (file.deviceFallbackId) {
    cached = file.deviceFallbackId;
    return cached;
  }
  cached = randomUUID();
  writeStore({ ...file, deviceFallbackId: cached });
  return cached;
}

/** What the store shows the customer on their devices page. */
export function deviceInfo(appVersion) {
  return {
    hostname: hostname(),
    platform: 'macos-arm64',
    osVersion: release(),
    appVersion: appVersion || null,
  };
}

