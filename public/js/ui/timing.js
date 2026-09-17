// Two ways to say "not on every event".

/** Run `fn` once, `ms` after the last call. */
export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Run `fn` at most once per animation frame, with the latest arguments. */
export function rafThrottle(fn) {
  let pending = false; let last = null;
  return (...args) => {
    last = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...last); });
  };
}
