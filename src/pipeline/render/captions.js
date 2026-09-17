// Burned captions for the final-pass lane, built from the offsets the join has just computed.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { programCues } from '../../subtitles/timeline.js';
import { buildAss, cueText } from '../../subtitles/ass.js';
import { measureCaptions } from '../../subtitles/box.js';
import { newId } from '../../util/util.js';
import { tp } from '../../i18n/t.js';

/**
 * @param {{subtitles:object|null, starts:number[], total:number, ow:number, oh:number, dir:string, note?:(s:string)=>void}} args
 * @returns {Promise<{text:string, path:string, fontsDir:string|null, shaping:string|null}|null>}
 */
export async function buildBurnedCaptions({ subtitles, starts, total, ow, oh, dir, note }) {
  const onNote = note, onLog = note;
  // Burned captions are built HERE rather than by the caller, because they need the offsets this
  // function has just computed. Anywhere else and the two would be free to disagree — which is
  // the drift this whole lane exists to avoid.
  let ass = null;
  if (subtitles?.style && subtitles.style.enabled !== false && subtitles.scenes?.length) {
    const cues = programCues(subtitles.scenes, starts, subtitles.config || {}, total);
    if (cues.length) {
      // A drawn caption background has to be given a size, and ASS cannot measure text. This is
      // the only place that can measure the RIGHT strings — the cues exist here and nowhere
      // earlier — and it still runs before the encode, so a failure costs nothing.
      const metrics = subtitles.style.box
        ? await measureCaptions(cues.map((c) => cueText(c, subtitles.style)), subtitles.style,
          subtitles.fontFile || null, { w: ow, h: oh })
        : null;
      const text = buildAss(cues, subtitles.style, { w: ow, h: oh }, metrics);
      const path = join(dir, `subs_${newId('')}.ass`);
      writeFileSync(path, text, 'utf8');
      ass = { text, path, fontsDir: subtitles.fontsDir || null, shaping: subtitles.shaping || null };
      (onNote || onLog)?.(tp`💬 In ${cues.length} dòng phụ đề lên video (font ${subtitles.style.font})`);
    }
  }
  return ass;
}
