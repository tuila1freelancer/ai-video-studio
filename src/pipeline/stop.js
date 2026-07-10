// Cooperative stop signal shared by the orchestrator and every stage. A single in-process
// Set keyed by projectId; stages call checkStop() at safe points and throw a tagged error
// the orchestrator recognises as a user-requested pause (not a failure).
const stopped = new Set();

/** Request the pipeline for `id` to pause at its next checkpoint. */
export function requestStop(id) { stopped.add(id); }
/** Clear the stop flag for `id` (called on start/finally). */
export function clearStop(id) { stopped.delete(id); }
/** @param {string} id @throws {Error} tagged `.stopped=true` when a stop was requested */
export function checkStop(id) { if (stopped.has(id)) { const e = new Error('stopped'); e.stopped = true; throw e; } }
/** True for stop errors — used as withRetry({fatal}) so a pause is never retried. */
export const notStopped = (e) => !!e.stopped;
/** @param {string} id @returns {boolean} whether a stop is pending for `id` */
export function isStopped(id) { return stopped.has(id); }
