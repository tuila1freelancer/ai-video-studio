// Async-local attribution context: which project/channel the current async chain is
// working for. Entry points (scheduler executor, legacy queue paths, regen)
// wrap their run so deep provider calls (llm/tts) can be metered per project without
// threading ids through every signature.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/** Run fn with {projectId, channelId} visible to everything it awaits. */
export function withRunContext(ctx, fn) { return als.run(ctx || {}, fn); }

/** The current attribution context ({} outside any run). */
export function currentRun() { return als.getStore() || {}; }
