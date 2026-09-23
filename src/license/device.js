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
import { readFileSync } from 'node:fs';
import { hostname, release } from 'node:os';
import { readStore, writeStore } from './store.js';
import { randomUUID } from 'node:crypto';
import { PLATFORM } from './config.js';

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

/**
 * Linux has no ioreg. /etc/machine-id is the same idea: written once when the system is installed,
 * stable across reboots. In a container it is per-IMAGE unless the host passes one in, which is
 * exactly why AVS_DEVICE_ID exists below.
 */
function machineId() {
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = readFileSync(file, 'utf8').trim();
      if (id) return id;
    } catch { /* next */ }
  }
  return null;
}

/** This machine's device id, as the store knows it. */
export function deviceId() {
  if (cached) return cached;
  // A container is a new machine every start, so a seat would be burned per restart. The operator
  // pins one id for the deployment and it stays the same machine to the store.
  if (process.env.AVS_DEVICE_ID) {
    cached = String(process.env.AVS_DEVICE_ID).slice(0, 120);
    return cached;
  }
  const uuid = platformUuid() || machineId();
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
    platform: PLATFORM,
    osVersion: release(),
    appVersion: appVersion || null,
  };
}

