// Load a module the first time it is needed, and only once.
//
// A screen or modal nobody has opened costs nothing until they do: the loader runs on the first
// trigger, the module wires its own listeners, and the trigger is replayed so that first click
// lands where every later one will.

/** Memoise an `import()` (or any async factory) so concurrent first uses share one load. */
export function once(load) {
  let p = null;
  return () => (p ||= load());
}

/**
 * Bind `selector` so the first click loads the module, calls `wire(mod)` — which attaches the
 * real listener — and then replays the click.
 * @param {string} selector
 * @param {() => Promise<object>} load
 * @param {(mod: object) => void} wire
 */
export function lazyClick(selector, load, wire) {
  const el = document.querySelector(selector);
  if (!el) return;
  const first = async (ev) => {
    ev.stopImmediatePropagation();
    el.removeEventListener('click', first, true);
    wire(await load());
    el.click();
  };
  el.addEventListener('click', first, true);
}
