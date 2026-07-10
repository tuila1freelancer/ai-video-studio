// Subtitle file builders: SRT (plain) + ASS (karaoke, fully styled).
import { applyTextCase } from '../util/util.js';

function pad(n, l = 2) { return String(Math.floor(n)).padStart(l, '0'); }
function srtTime(t) {
  const ms = Math.round((t % 1) * 1000);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
function assTime(t) {
  const cs = Math.round((t % 1) * 100);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export function buildSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

// #RRGGBB → &H00BBGGRR (ASS, alpha 00 = opaque)
function hexToAss(hex, alpha = '00') {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#F7B500');
  const v = m ? m[1] : 'F7B500';
  const r = v.slice(0, 2), g = v.slice(2, 4), b = v.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

// Map a subtitle position config to ASS alignment + margins.
function resolveAlignment(pos) {
  const map = { top: 8, mid: 5, bot: 2, bl: 1, br: 3, tl: 7, tr: 9 };
  return map[pos] || 2;
}

/**
 * Build a karaoke ASS file.
 * cues: [{start,end,text,words:[{start,end,word}]}] times relative to this clip.
 * style: { font, fontSize, textCase, color, base, position:{preset,xPct,yPct}, karaoke }
 * size: { w, h }
 */
export function buildKaraokeAss(cues, style, size) {
  const w = size.w, h = size.h;
  const font = style.font || 'Be Vietnam Pro';
  const fontSize = Math.round((style.fontSize || 80) * (h / 1920));
  const primary = hexToAss(style.color || '#F7B500');     // sung / highlight
  const secondary = hexToAss(style.base || '#FFFFFF');     // unsung / base
  const align = resolveAlignment(style.position?.preset || 'bot');
  const marginV = Math.round((style.position?.marginV ?? 0.12) * h);
  const bold = style.bold === false ? 0 : -1;
  // Preset effect → ASS approximation. Defaults reproduce the historic look exactly.
  let borderStyle = 1;
  let outline = '&H00101010';
  let back = '&H80000000';
  let outlineW = Math.max(2, Math.round(fontSize * 0.06));
  let shadow = 2;
  if (style.effect === 'outline') {
    outline = '&H00000000';
    outlineW = Math.max(3, Math.round(fontSize * 0.09));
    shadow = 0;
  } else if (style.effect === 'box') {
    borderStyle = 3; // opaque box uses OutlineColour as the box fill
    outline = hexToAss(style.boxBg || '#0A0A10', '30');
    outlineW = Math.max(4, Math.round(fontSize * 0.12));
    shadow = 0;
  } else if (style.effect === 'shadow') {
    outlineW = Math.max(1, Math.round(fontSize * 0.03));
    shadow = Math.max(3, Math.round(fontSize * 0.07));
  } else if (style.effect === 'glow') {
    outline = hexToAss(style.color || '#F7B500', '60'); // soft colored halo
    outlineW = Math.max(2, Math.round(fontSize * 0.07));
  }

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Def,${font},${fontSize},${primary},${secondary},${outline},${back},${bold},0,0,0,100,100,0,0,${borderStyle},${outlineW},${shadow},${align},80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const usePos = style.position && style.position.xPct != null && style.position.yPct != null;
  const posTag = usePos ? `{\\an5\\pos(${Math.round(style.position.xPct * w)},${Math.round(style.position.yPct * h)})}` : '';

  const lines = cues.map((c) => {
    let text;
    if (style.karaoke !== false && c.words && c.words.length) {
      text = c.words.map((wd) => {
        const k = Math.max(1, Math.round((wd.end - wd.start) * 100));
        return `{\\kf${k}}${applyTextCase(wd.word, style.textCase)} `;
      }).join('').trim();
    } else {
      text = applyTextCase(c.text, style.textCase);
    }
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Def,,0,0,0,,${posTag}${text}`;
  });

  return header + lines.join('\n') + '\n';
}

// shift cue/word times by `offset` seconds (for building a whole-video ASS)
export function shiftCues(cues, offset) {
  return cues.map((c) => ({
    start: c.start + offset, end: c.end + offset,
    text: c.text,
    words: (c.words || []).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })),
  }));
}
