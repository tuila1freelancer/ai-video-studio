// Final-pass captions: the clips were rendered bare, so the burn happens at the join — with a real font file.
import { resolveGuide, themeFromGuide } from '../../styleguide/index.js';
import { burnStyleFrom } from '../../subtitles/presets.js';
import { prepareBurnFontDir, shapingFor } from '../../fonts/files.js';
import { op } from '../progress.js';
import { resolveLang } from '../../util/lang.js';
import { tp } from '../../i18n/t.js';

/**
 * @param {{projectId:string, config:object, size:{w:number,h:number}, scenes:object[], renderDir:string}} args
 * @returns {object|null} the burn description concatScenes() takes, or null when captions live in the clips
 */
export function finalPassCaptions({ projectId, config, size, scenes, renderDir }) {
  // Final-pass captions. The clips were rendered bare, so the burn happens here — and the font
  // is resolved to a real file FIRST, because fontconfig substitutes without a word and a video
  // in the wrong typeface is finished work, not a warning.
  let subtitles = null;
  if (config.subtitleLane === 'final' && config.enableSubtitles !== false) {
    const theme = themeFromGuide(resolveGuide(config));
    const style = burnStyleFrom(config, theme, size);
    const { fontsDir, file, source } = prepareBurnFontDir(style.font, style.weight, renderDir);
    op(projectId, tp`🔤 Phụ đề in ở bước cuối — font "${style.font}" (${source})`);
    subtitles = { scenes, config, style, fontsDir, fontFile: file, shaping: shapingFor(resolveLang(config, scenes)) };
  }
  return subtitles;
}
