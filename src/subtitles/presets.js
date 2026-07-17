// Subtitle style presets shared by animation captions (harness .cap/.capw) and the
// libass/ASS export path. Pure data + resolvers — imports nothing, so both
// src/animation/* and src/pipeline/* can consume it without cycles.
//
// Resolution order in both resolvers: preset (config.subtitlePreset) is the base,
// explicit config fields (subtitleColor/subtitleFontSize/subtitleTextCase/subtitlePosition,
// subtitleFont for ASS) fine-tune on top. With no preset the output is byte-identical
// to the pre-preset behavior of buildSceneHtml / runner.subtitleStyleFrom.

// macOS system fonts for CJK scripts — every preset carries the same fallbacks.
function perLangDefaults() {
  return {
    ja: { fontStack: "'Hiragino Sans',sans-serif", assFont: 'Hiragino Sans' },
    ko: { fontStack: "'Apple SD Gothic Neo',sans-serif", assFont: 'Apple SD Gothic Neo' },
    zh: { fontStack: "'PingFang SC',sans-serif", assFont: 'PingFang SC' },
  };
}

export const SUBTITLE_PRESETS = [
  {
    id: 'classic-karaoke', name: 'Karaoke Vàng',
    fontStack: "'Be Vietnam Pro', -apple-system, sans-serif", assFont: 'Be Vietnam Pro', weight: 800,
    activeColor: '#F7B500', baseColor: '#FFFFFF', effect: 'glow',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'original', perLang: perLangDefaults(),
  },
  {
    id: 'bold-impact', name: 'Impact Đậm',
    fontStack: "'Anton', 'Arial Narrow', sans-serif", assFont: 'Anton', weight: 400,
    activeColor: '#FFFFFF', baseColor: '#E8E8E8', effect: 'outline',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'uppercase', perLang: perLangDefaults(),
  },
  {
    id: 'neon-glow', name: 'Neon Rực',
    fontStack: "'Montserrat', 'Helvetica Neue', sans-serif", assFont: 'Montserrat', weight: 800,
    activeColor: '#00E5FF', baseColor: '#EAF2FF', effect: 'glow',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'original', perLang: perLangDefaults(),
  },
  {
    id: 'boxed-news', name: 'Bản Tin',
    fontStack: "'Lexend', -apple-system, sans-serif", assFont: 'Lexend', weight: 700,
    activeColor: '#FFFFFF', baseColor: '#FFFFFF', effect: 'box', boxBg: 'rgba(17,17,17,0.85)',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'original', perLang: perLangDefaults(),
  },
  {
    id: 'shadow-cinema', name: 'Điện Ảnh',
    fontStack: "'Be Vietnam Pro', -apple-system, sans-serif", assFont: 'Be Vietnam Pro', weight: 700,
    activeColor: '#FFD166', baseColor: '#F5F5F5', effect: 'shadow',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'original', perLang: perLangDefaults(),
  },
  {
    // lighter shadow than shadow-cinema — the consumer should reduce blur/offset for this preset
    id: 'clean-minimal', name: 'Tối Giản',
    fontStack: "'Lexend', -apple-system, sans-serif", assFont: 'Lexend', weight: 700,
    activeColor: '#FFFFFF', baseColor: '#C9D2E3', effect: 'shadow',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'original', perLang: perLangDefaults(),
  },
  {
    id: 'pop-rounded', name: 'Pop Tròn',
    fontStack: "'Nunito', -apple-system, sans-serif", assFont: 'Nunito', weight: 900,
    activeColor: '#FF2D78', baseColor: '#FFFFFF', effect: 'glow',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'original', perLang: perLangDefaults(),
  },
  {
    id: 'condensed-sport', name: 'Thể Thao',
    fontStack: "'Oswald', 'Arial Narrow', sans-serif", assFont: 'Oswald', weight: 700,
    activeColor: '#3DF5A6', baseColor: '#FFFFFF', effect: 'outline',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'uppercase', perLang: perLangDefaults(),
  },
  {
    id: 'archivo-punch', name: 'Punch',
    fontStack: "'Archivo Black', 'Arial Black', sans-serif", assFont: 'Archivo Black', weight: 400,
    activeColor: '#FFB020', baseColor: '#FFFFFF', effect: 'outline',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'uppercase', perLang: perLangDefaults(),
  },
  {
    id: 'mono-terminal', name: 'Terminal',
    fontStack: "'JetBrains Mono', ui-monospace, Menlo, monospace", assFont: 'JetBrains Mono', weight: 700,
    activeColor: '#3DF5A6', baseColor: '#9FE8C9', effect: 'box', boxBg: '#04140B',
    position: { preset: 'bot', marginV: 0.12 }, textCase: 'lowercase', perLang: perLangDefaults(),
  },
];

export function getSubtitlePreset(id) {
  if (!id) return null;
  return SUBTITLE_PRESETS.find((p) => p.id === id) || null;
}

/**
 * Bare font FAMILY from whatever the config carries (P30). Older configs stored the whole
 * CSS stack ("'Anton', sans-serif") — libass would treat that as a (nonexistent) font name
 * and the harness would quote it wrong. One normalizer feeds both consumers.
 */
export function familyName(v) {
  return String(v || '').split(',')[0].replace(/['"]/g, '').trim();
}

/**
 * Caption style for the animation harness (buildScenePage captionStyle).
 * → { color, baseColor, fontFamily, weight, effect, boxBg?, fontSizePx, bottomPct, textCase }
 * Without a preset it returns exactly what buildSceneHtml computed before presets
 * existed ({ color, fontSizePx } only) so existing harness output stays byte-identical.
 */
export function captionStyleFrom(config, theme, { w, h }) {
  const c = config || {};
  const fontSizePx = c.subtitleFontSize
    ? Math.round(c.subtitleFontSize * (Math.min(w, h) / 1080) * 0.72)
    : undefined;
  // P30: the owner's explicit font pick ALWAYS wins — before this, subtitleFont only
  // reached the ASS burn path and the animation captions silently kept the page font.
  const fam = familyName(c.subtitleFont);
  const pickedStack = fam ? `'${fam}', -apple-system, sans-serif` : undefined;
  const mode = c.subtitleMode === 'plain' ? 'plain' : 'karaoke';
  const preset = getSubtitlePreset(c.subtitlePreset);
  if (!preset) {
    return {
      color: c.subtitleColor || theme.accents[0], fontSizePx,
      ...(pickedStack ? { fontFamily: pickedStack } : {}), mode,
    };
  }
  const lang = (c.subtitleLang || c.language || '').toLowerCase();
  const pl = preset.perLang && preset.perLang[lang];
  const pos = c.subtitlePosition || preset.position || {};
  return {
    color: c.subtitleColor || preset.activeColor,
    baseColor: preset.baseColor,
    fontFamily: pickedStack || (pl && pl.fontStack) || preset.fontStack,
    weight: preset.weight,
    effect: preset.effect,
    ...(preset.boxBg ? { boxBg: preset.boxBg } : {}),
    fontSizePx,
    bottomPct: pos.marginV != null ? Math.round(pos.marginV * 100) : undefined,
    textCase: c.subtitleTextCase || preset.textCase,
    mode,
  };
}

/**
 * ASS/libass style — same shape runner.subtitleStyleFrom(config) returns today
 * (enabled/karaoke/font/fontSize/textCase/color/base/position) plus { effect, weight }
 * (and boxBg for box presets) when a preset is active. assStyleFrom({}) deep-equals
 * the current subtitleStyleFrom({}) output.
 */
export function assStyleFrom(config) {
  const c = config || {};
  const picked = familyName(c.subtitleFont); // bare family — a CSS stack would break libass
  const style = {
    enabled: c.enableSubtitles !== false,
    karaoke: c.subtitleMode !== 'plain', // P29: plain mode burns static lines, no \k sweep
    font: picked || 'Be Vietnam Pro',
    fontSize: parseInt(c.subtitleFontSize || 80, 10),
    textCase: c.subtitleTextCase || 'original',
    color: c.subtitleColor || '#F7B500',
    base: '#FFFFFF',
    position: c.subtitlePosition || { preset: 'bot', marginV: 0.12 },
    // display re-chunking travels with the style so the burn site can rebuild cues (P29)
    chunk: c.subtitleChunk || 'auto',
    wordsPerCue: c.subtitleWordsPerCue || 4,
  };
  const preset = getSubtitlePreset(c.subtitlePreset);
  if (!preset) return style;
  const lang = (c.subtitleLang || c.language || '').toLowerCase();
  const pl = preset.perLang && preset.perLang[lang];
  return {
    ...style,
    font: picked || (pl && pl.assFont) || preset.assFont,
    textCase: c.subtitleTextCase || preset.textCase,
    color: c.subtitleColor || preset.activeColor,
    base: preset.baseColor,
    position: c.subtitlePosition || { ...preset.position },
    effect: preset.effect,
    weight: preset.weight,
    ...(preset.boxBg ? { boxBg: preset.boxBg } : {}),
  };
}
