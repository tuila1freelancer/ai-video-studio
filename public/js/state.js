// Shared mutable app state — flat object, mutated imperatively by views/features.
export const state = {
  projects: [], current: null, scenes: [], settings: null, voices: [], styles: [],
  galleryCat: 'short', libKind: 'brand', libBrand: 'Default', subColor: '#F7B500', assets: [], wsOpen: false,
  templates: [], subPreset: '', subPresets: [], presets: [], brandDraft: null,
};

export function activeChannelBrand() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  return ch?.config?.brandKit || null;
}

/**
 * What a NEW video of the active channel starts from.
 *
 * Mirrors the server's own layering for project creation — channel.config, then the channel's
 * DEFAULT preset over it (core/config.js `resolveProjectConfig`), one level deep so a preset that
 * sets `hyperframe.density` does not wipe the channel's `hyperframe.styleId`.
 *
 * The panel had no equivalent, and it showed: nothing loaded the channel's config at startup, and
 * "video mới" left the previous project's settings sitting in the form. The saved channel config
 * was still applied server-side, so the video came out right while the panel described a different
 * one — and the moment the owner touched anything, the panel's version won.
 */
export function channelDefaults() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  const def = (state.presets || []).find((p) => p.is_default);
  const out = { ...(ch?.config || {}) };
  for (const [k, v] of Object.entries(def?.config || {})) {
    const cur = out[k];
    const plain = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
    out[k] = plain(cur) && plain(v) ? { ...cur, ...v } : v;
  }
  return out;
}
