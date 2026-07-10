// Design-token themes for the animation engine.
// 'neon-tech' replicates the reference channel: dark navy, neon glow typography, HUD accents.

export const THEMES = {
  'neon-tech': {
    name: 'Neon Tech',
    bg: '#0A0E1E', bg2: '#0D1226', panel: 'rgba(16,22,44,0.55)', panelBorder: 'rgba(120,160,255,0.16)',
    ink: '#EAF2FF', muted: '#8FA3C8', dim: '#4A5878',
    accents: ['#00E5FF', '#FF2D78', '#FFB020', '#A855F7', '#3DF5A6'],
    gradBar: 'linear-gradient(90deg,#FF2D78,#A855F7,#00E5FF)',
    glow: (c) => `0 0 14px ${c}AA, 0 0 44px ${c}55`,
    glowSoft: (c) => `0 0 10px ${c}66, 0 0 30px ${c}2E`,
    font: `'Be Vietnam Pro', -apple-system, 'Helvetica Neue', sans-serif`,
    mono: `'JetBrains Mono', ui-monospace, Menlo, monospace`,
    particles: 64, grid: true, streak: true, vignette: 0.55, noise: 0.05,
  },
  'minimal-light': {
    name: 'Minimal Light',
    bg: '#F6F7FB', bg2: '#FFFFFF', panel: 'rgba(255,255,255,0.8)', panelBorder: 'rgba(15,23,42,0.10)',
    ink: '#0F172A', muted: '#64748B', dim: '#B6C0D4',
    accents: ['#2563EB', '#E11D48', '#D97706', '#7C3AED', '#059669'],
    gradBar: 'linear-gradient(90deg,#2563EB,#7C3AED)',
    glow: () => 'none', glowSoft: () => 'none',
    font: `'Be Vietnam Pro', -apple-system, 'Helvetica Neue', sans-serif`,
    mono: `'JetBrains Mono', ui-monospace, Menlo, monospace`,
    particles: 0, grid: false, streak: false, vignette: 0, noise: 0,
  },
  'gradient-soft': {
    name: 'Gradient Soft',
    bg: '#151032', bg2: '#1C1440', panel: 'rgba(40,28,86,0.5)', panelBorder: 'rgba(180,150,255,0.18)',
    ink: '#F4EFFF', muted: '#B4A6DC', dim: '#5D5088',
    accents: ['#8B5CF6', '#F472B6', '#38BDF8', '#FBBF24', '#34D399'],
    gradBar: 'linear-gradient(90deg,#F472B6,#8B5CF6,#38BDF8)',
    glow: (c) => `0 0 16px ${c}88, 0 0 40px ${c}44`,
    glowSoft: (c) => `0 0 10px ${c}55, 0 0 26px ${c}22`,
    font: `'Be Vietnam Pro', -apple-system, 'Helvetica Neue', sans-serif`,
    mono: `'JetBrains Mono', ui-monospace, Menlo, monospace`,
    particles: 40, grid: false, streak: true, vignette: 0.4, noise: 0,
  },
};

export function getTheme(id) { return THEMES[id] || THEMES['neon-tech']; }
export function accentFor(theme, idx) { return theme.accents[(idx || 0) % theme.accents.length]; }
