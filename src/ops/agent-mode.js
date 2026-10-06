// Whether this installation lets agents in, and therefore whether tokens are enforced.
//
// AVS_MODE=server is a deployment decision made before the process starts. An installed desktop app
// has no environment to set — the user decides in the app, and the decision has to survive a
// restart, so it lives in settings like every other thing the user chose.
//
// Enforcing tokens on loopback is the point rather than a side effect: without it every process on
// the machine is the user, nothing can be revoked, and no journal line can say which agent asked.
import { getSetting, setSetting } from '../db/index.js';

/** @returns {{enabled: boolean, since: number|null}} */
export function agentMode() {
  const s = getSetting('agent', null) || {};
  return { enabled: s.enabled === true, since: s.since || null };
}

export const agentEnabled = () => agentMode().enabled;

/** @param {{enabled: boolean}} next */
export function setAgentMode({ enabled }) {
  setSetting('agent', { enabled: enabled === true, since: enabled === true ? Date.now() : null });
  return agentMode();
}
