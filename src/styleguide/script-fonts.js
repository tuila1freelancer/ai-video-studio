// A font that can actually draw the video's script, appended to every stack in the guide.
//
// Nothing outside Latin and Vietnamese is bundled: vendor/fonts/fonts.css carries three
// unicode-ranges, and the eleven TTFs staged for the subtitle burn are the same Latin faces. So a
// Russian, Chinese, Thai or Hindi video asked Chrome for 'Oswald', 'Be Vietnam Pro', sans-serif —
// none of which has the glyphs — and got whatever the renderer picked, at whatever weight, with
// nobody told. The registry already knew which families cover which script and which of them the
// OS provides; the guide simply never asked.
//
// Deliberately system families and not a download: this runs inside a render, and the font store's
// own rule is that a download is something the owner asked for, never something a paying job does
// on its own. Both macOS and Windows names are listed so a stack works on either.
import { lang as langRow } from '../i18n/languages.js';

const BY_SCRIPT = {
  'cjk-sc': ["'PingFang SC'", "'Microsoft YaHei'", "'Noto Sans SC'"],
  'cjk-tc': ["'PingFang TC'", "'Microsoft JhengHei'", "'Noto Sans TC'"],
  japanese: ["'Hiragino Sans'", "'Yu Gothic'", "'Noto Sans JP'"],
  korean: ["'Apple SD Gothic Neo'", "'Malgun Gothic'", "'Noto Sans KR'"],
  thai: ["'Thonburi'", "'Leelawadee UI'", "'Noto Sans Thai'"],
  devanagari: ["'Kohinoor Devanagari'", "'Nirmala UI'", "'Noto Sans Devanagari'"],
  cyrillic: ["'Helvetica Neue'", "'Segoe UI'", "'Noto Sans'"],
  greek: ["'Helvetica Neue'", "'Segoe UI'", "'Noto Sans'"],
  arabic: ["'Geeza Pro'", "'Segoe UI'", "'Noto Sans Arabic'"],
  hebrew: ["'Arial Hebrew'", "'Segoe UI'", "'Noto Sans Hebrew'"],
};

/** The families to fall back to for a language's script, or [] when the vendored set covers it. */
export function scriptFallback(code) {
  return BY_SCRIPT[langRow(code).script] || [];
}

/**
 * Insert the script's families into a CSS stack, just before its generic keyword.
 *
 * Before the generic on purpose: the guide's own display face still wins wherever it has the
 * glyph, so a Chinese video keeps its Latin headline font for the Latin words in it and only
 * falls to PingFang for the characters Oswald cannot draw.
 */
export function withScriptFallback(stack, code) {
  const extra = scriptFallback(code);
  if (!extra.length) return stack;
  const s = String(stack || '').trim();
  if (!s) return extra.join(', ');
  const already = extra.filter((f) => !s.includes(f.replace(/'/g, '')));
  if (!already.length) return s;
  const m = s.match(/,\s*(sans-serif|serif|monospace|ui-monospace|system-ui)\s*$/);
  return m ? `${s.slice(0, m.index)}, ${already.join(', ')}${s.slice(m.index)}` : `${s}, ${already.join(', ')}`;
}

/** Every font stack in a guide, able to draw `code`'s script. */
export function guideForLanguage(guide, code) {
  if (!guide?.fonts || !scriptFallback(code).length) return guide;
  return {
    ...guide,
    fonts: {
      display: withScriptFallback(guide.fonts.display, code),
      body: withScriptFallback(guide.fonts.body, code),
      mono: withScriptFallback(guide.fonts.mono, code),
    },
  };
}
