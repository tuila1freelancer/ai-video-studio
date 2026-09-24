// What a server cannot do, said out loud.
//
// Three routes open a folder in the desktop's file manager. On a machine with no desktop they used
// to swallow the failure and answer ok, which is worse than a refusal: the caller believes a window
// opened somewhere. AVS_HEADLESS says the truth instead — and the reply names the path, which is
// what the caller wanted the window for.
import { apiError } from './api-codes.js';
import { m } from '../i18n/t.js';

/** Set by a container image or a service unit; a desktop app never sets it. */
export function isHeadless(env = process.env) {
  return env.AVS_HEADLESS === '1';
}

/** Throw the refusal a headless deployment owes a caller asking for a window. */
export function refuseHeadless(path) {
  const err = apiError('headless', m('bản chạy máy chủ không mở được thư mục — dùng đường dẫn'), 501);
  err.path = path || null;
  throw err;
}
