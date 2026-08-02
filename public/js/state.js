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
