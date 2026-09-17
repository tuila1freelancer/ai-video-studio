// Cooperative stop signal shared by the orchestrator and every stage. A single in-process
// Set keyed by projectId; stages call checkStop() at safe points and throw a tagged error
// the orchestrator recognises as a user-requested pause (not a failure).
//
// Two things this module deliberately does NOT do:
//
//   - it does not touch the database. The durable half of a stop (so the decision survives
//     quitting the app) lives in `projects.stop_requested_at`, written by pipeline/queue.js.
//     Keeping this file dependency-free is what lets media/ffmpeg.js import `stopError` without
//     dragging the whole persistence layer into the process-spawn path.
//   - it does not decide policy. Whether a stop is honoured at a given moment is up to the
//     checkpoints; this only records that one was asked for.
const stopped = new Set();
const aborters = new Map(); // projectId -> AbortController for the child processes it owns

/** The one definition of "the user stopped this" — `.stopped` is the tag every layer reads. */
export function stopError() {
  const e = new Error('stopped');
  e.stopped = true;
  return e;
}

/** Request the pipeline for `id` to pause at its next checkpoint. */
export function requestStop(id) {
  stopped.add(id);
  // Checkpoints only fire between steps. A concat encode is a single step that can run for
  // fifteen minutes, so the child process is aborted as well — otherwise "Dừng" means "stop
  // eventually", which is what it looked like from the outside.
  const ac = aborters.get(id);
  if (ac && !ac.signal.aborted) ac.abort(stopError());
}

/** Clear the stop flag for `id` (called on start/finally). */
export function clearStop(id) {
  stopped.delete(id);
  aborters.delete(id); // a new run gets a fresh controller; an aborted one can never be reused
}

/**
 * The AbortSignal for `id`'s long-running child processes. Created on demand so a project that
 * never spawns anything never allocates one.
 */
export function abortSignalFor(id) {
  if (!id) return undefined;
  let ac = aborters.get(id);
  if (!ac) {
    ac = new AbortController();
    aborters.set(id, ac);
    if (stopped.has(id)) ac.abort(stopError()); // stop already pending — never hand out a live signal
  }
  return ac.signal;
}

/** Shutdown: every child process still running gets the same stop the owner would have sent. */
export function abortAll() {
  for (const [id, ac] of aborters) { stopped.add(id); if (!ac.signal.aborted) ac.abort(stopError()); }
}

/** @param {string} id @throws {Error} tagged `.stopped=true` when a stop was requested */
export function checkStop(id) { if (stopped.has(id)) throw stopError(); }

/** True for stop errors — used as withRetry({fatal}) so a pause is never retried. */
export const notStopped = (e) => !!e.stopped;

/** @param {string} id @returns {boolean} whether a stop is pending for `id` */
export function isStopped(id) { return stopped.has(id); }

/**
 * Boot: re-arm the signal for projects whose stop was never honoured, so anything that does
 * reach a checkpoint in this process stops at it rather than running to completion.
 */
export function hydrateStops(ids = []) {
  for (const id of ids) stopped.add(id);
  return stopped.size;
}
