// A channel remembers how its subtitles look.
//
// Until now the subtitle style lived only in the project being edited. Getting it onto the next
// video meant finding a save icon inside the channel-management dialog, which wrote the WHOLE
// panel over the channel — so the owner re-picked the font for every video, or overwrote settings
// they never meant to touch. Owner order 2026-08-06: editing a channel's subtitles saves them for
// that channel, automatically.
//
// Two rules make it safe to call this on every keystroke:
//
//   Only subtitle keys get through. The panel is a big object and this is a narrow door; a bug in
//   the caller must not be able to rewrite a channel's voice, resolution or brand kit.
//
//   An unstated value is never stored. Every key is validated, so a control that has not been
//   populated yet (the font picker is empty until the registry loads) is DROPPED rather than
//   written as a blank. That is also what makes the on/off switch safe: turning subtitles off
//   sends `enableSubtitles: false` and leaves every style key exactly as it was, so turning them
//   back on restores the look the owner had.
import * as DB from '../../db/index.js';

/**
 * What counts as a subtitle setting, and what counts as a real value for it.
 *
 * The empties are deliberate and not uniform: `subtitlePreset: ''` means "tuỳ biến tay" and
 * `subtitleTextCase: ''` means "theo bộ mẫu" — both are choices the owner can make and both must
 * persist. An empty FONT or COLOUR is not a choice, it is a control that has not loaded.
 */
const bool = (v) => typeof v === 'boolean';
const hex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
const range = (lo, hi) => (v) => Number.isFinite(+v) && v !== '' && v !== null && +v >= lo && +v <= hi;
const oneOf = (...allowed) => (v) => allowed.includes(v);

export const SUBTITLE_KEYS = {
  enableSubtitles: bool,
  subtitleMode: oneOf('karaoke', 'plain'),
  subtitleChunk: oneOf('auto', 'sentence', 'words'),
  subtitleWordsPerCue: range(2, 10),
  subtitlePreset: (v) => typeof v === 'string',
  subtitleFont: (v) => typeof v === 'string' && v.trim() !== '',
  subtitleFontSize: (v) => Number.isFinite(+v) && +v > 0,
  subtitleTextCase: oneOf('', 'original', 'uppercase', 'lowercase', 'titlecase', 'sentence'),
  subtitleColor: hex,
  subtitlePosition: (v) => !!v && typeof v === 'object' && ['bot', 'mid', 'top'].includes(v.preset),

  // ---- the full studio ----------------------------------------------------
  // Every range below is a guard against a value that would ruin a render rather than merely look
  // odd — a negative font weight, a 400% margin, an outline wider than the frame. The panel's own
  // sliders are narrower; these are the outer walls, so a hand-edited config still cannot burn a
  // video into nonsense.
  subtitleWeight: range(100, 1000),
  subtitleItalic: bool,
  subtitleUnderline: bool,
  subtitleStrike: bool,
  subtitleLetterSpacing: range(-20, 60),
  subtitleScaleX: range(25, 400),
  subtitleScaleY: range(25, 400),
  subtitleAngle: range(-180, 180),

  subtitleBaseColor: hex,
  subtitleOutlineColor: hex,
  subtitleOutlineWidth: range(0, 200),
  subtitleShadowColor: hex,
  subtitleShadowDepth: range(0, 200),
  subtitleGlowColor: hex,
  subtitleGlow: range(0, 100),
  subtitleDimUnread: range(0, 1),
  subtitleDimRead: range(0, 1),

  subtitleBox: bool,
  subtitleBoxColor: hex,
  subtitleBoxOpacity: range(0, 1),
  subtitleBoxRadius: range(0, 200),
  subtitleBoxBorderColor: hex,
  subtitleBoxBorderWidth: range(0, 60),
  subtitleBoxPadding: (v) => !!v && typeof v === 'object' && !Array.isArray(v)
    && ['top', 'right', 'bottom', 'left'].every((k) => v[k] == null || range(0, 300)(v[k])),

  subtitleAlignH: oneOf('left', 'center', 'right'),
  subtitleMarginV: range(0, 95),
  subtitleMarginH: range(0, 45),
  subtitleWrap: oneOf(0, 1, 2, 3),
  subtitleMaxChars: range(8, 80),
  subtitleMaxLines: range(1, 4),

  subtitleKaraokeStyle: oneOf('color', 'box', 'pop'),
  subtitleReveal: bool,
  subtitlePopScale: range(100, 200),
  subtitleFadeIn: range(0, 2000),
  subtitleFadeOut: range(0, 2000),
};

/** The subtitle settings out of an arbitrary config object, blanks and strangers removed. */
export function pickSubtitleConfig(config = {}) {
  const out = {};
  for (const [k, valid] of Object.entries(SUBTITLE_KEYS)) {
    if (k in config && valid(config[k])) out[k] = config[k];
  }
  return out;
}

/**
 * Store a channel's subtitle look so every later video of that channel starts with it.
 *
 * @param {string} channelId
 * @param {object} incoming a config-shaped object; anything that is not a subtitle setting, and
 *   any subtitle setting whose value is not usable, is ignored
 * @returns {{channel:object, preset:object|null, saved:string[]}}
 */
export function saveSubtitleDefaults(channelId, incoming = {}) {
  const ch = DB.getChannel(channelId);
  if (!ch) throw new Error('không tìm thấy kênh');
  const patch = pickSubtitleConfig(incoming);
  const saved = Object.keys(patch);
  if (!saved.length) return { channel: ch, preset: null, saved };

  const channel = DB.updateChannel(channelId, { config: { ...(ch.config || {}), ...patch } });

  // The channel's DEFAULT preset is layered OVER channel.config for every new project
  // (routes: resolveProjectConfig({channel, preset: defaultPresetFor(...)})). A preset saved from
  // the whole panel months ago therefore carries a subtitle look too, and it would shadow what was
  // just stored — the setting would appear to save and then not apply. Named presets the owner
  // picks by hand are left alone; this is only the one that applies itself.
  const def = DB.defaultPresetFor(channelId);
  const preset = def ? DB.updatePreset(def.id, { config: { ...(def.config || {}), ...patch } }) : null;
  return { channel, preset, saved };
}
