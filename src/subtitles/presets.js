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

// Distance from the BOTTOM of the frame, in %, for each position preset (harness .cap bottom).
const POSITION_BOTTOM_PCT = { bot: 12, mid: 45, top: 80 };

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
    // No subtitle preset chosen — this branch must return exactly what buildSceneHtml computed
    // before presets existed, or every old video shifts on re-render. The ONE addition is the
    // position preset, and only for 'mid'/'top': those never did anything, while 'bot'/absent
    // stays undefined so the harness keeps its own default (10% tall / 7% wide) untouched.
    const movedTo = POSITION_BOTTOM_PCT[c.subtitlePosition?.preset];
    return {
      color: c.subtitleColor || theme.accents[0], fontSizePx,
      ...(pickedStack ? { fontFamily: pickedStack } : {}), mode,
      ...(c.subtitlePosition?.preset && c.subtitlePosition.preset !== 'bot' && movedTo != null ? { bottomPct: movedTo } : {}),
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
    // P42: the Dưới/Giữa/Trên select was DEAD — bottomPct read only marginV, and the panel always
    // sends 0.12, so 'mid'/'top' rendered identically to 'bot'. The preset now decides, with
    // marginV as the fallback for a caller that passes one without a preset. 'bot' maps to 12 on
    // purpose: it is exactly what every existing project already rendered, so no finished video
    // shifts when it is re-rendered — only the two settings that never worked start working.
    bottomPct: POSITION_BOTTOM_PCT[pos.preset] ?? (pos.marginV != null ? Math.round(pos.marginV * 100) : undefined),
    textCase: c.subtitleTextCase || preset.textCase,
    mode,
  };
}

/**
 * Everything the FINAL-PASS burn needs, resolved through the same math the DOM lane uses.
 *
 * The two lanes have to agree or the app lies to the owner: they pick a style in a preview the
 * browser draws, and the burned video has to be that. The trap is font size — `assStyleFrom`
 * reports the raw config number (80) while the harness renders `80 × (min(w,h)/1080) × 0.72`
 * (58px at 1080p). Burning at 80 would ship subtitles 38% larger than every preview showed. So
 * the geometry comes from `captionStyleFrom` and only the libass-specific bits (bare family name,
 * karaoke on/off) come from `assStyleFrom`.
 *
 * The `|| Math.min(w,h)*0.052` and `?? (h>w ? 10 : 7)` defaults are the harness's own fallbacks
 * (buildScenePage capFS/capBottom) restated — the DOM lane leaves them undefined and lets the
 * page decide, but a burn has to name a number.
 */
export function burnStyleFrom(config, theme, { w, h }) {
  const cap = captionStyleFrom(config, theme, { w, h });
  const ass = assStyleFrom(config);
  return {
    enabled: ass.enabled,
    font: familyName(cap.fontFamily) || ass.font,
    fontSizePx: Math.round(cap.fontSizePx || Math.min(w, h) * 0.052),
    bottomPct: cap.bottomPct ?? (h > w ? 10 : 7),
    color: cap.color || theme?.accents?.[0] || '#F7B500',
    baseColor: cap.baseColor || theme?.ink || '#FFFFFF',
    weight: cap.weight || 800,
    effect: cap.effect || 'glow',
    boxBg: cap.boxBg || null,
    textCase: cap.textCase || 'original',
    mode: cap.mode === 'plain' ? 'plain' : 'karaoke',
    marginPct: 0.06, // .cap{left:6%;right:6%}
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
