// Does this font FILE actually carry the script we say it does?
//
// `registry.js` declares a `scripts` list per family, by hand. That list is what puts a face in
// front of the owner for a given language — and it was wrong: Archivo Black claimed Vietnamese and
// its file is missing 11 of 13 probe codepoints, so every tone-marked letter in a Vietnamese video
// came out of whatever font the renderer fell back to. A claim about a file has to be CHECKED
// against the file.
//
// Only cmap formats 4 and 12 are read. Between them they cover every font this app can be handed;
// a face whose cmap is neither reports "unknown" and is believed, because refusing a font we
// merely failed to parse would be worse than the bug this closes.
import { readFileSync, statSync } from 'node:fs';

/**
 * A handful of characters per script — enough to catch a subset that stops at Latin, small enough
 * to read. Vietnamese leads with the STACKED marks (a breve or circumflex carrying a tone), which
 * are the first thing a partial subset drops.
 */
export const SCRIPT_PROBES = {
  vietnamese: [...'ĂÂĐÊÔƠƯẠẴẶẾỘỮỸộữếặ'],
  cyrillic: [...'АБЯЖийё'],
  greek: [...'ΑΩΠπλή'],
  thai: [...'กมษาิ่'],
  devanagari: [...'अकनीे्'],
  hebrew: [...'אבשםִ'],
  arabic: [...'اببـشي'],
  'cjk-sc': [...'的一是不中'],
  'cjk-tc': [...'的一是不個'],
  japanese: [...'あアン日本'],
  korean: [...'가나한글다'],
  latin: [...'AZaz09'],
};

const u16 = (b, o) => b.readUInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);

/** Byte offset of the cmap table, following a .ttc collection to its first font. */
function cmapOffset(b) {
  let base = 0;
  if (b.toString('ascii', 0, 4) === 'ttcf') base = u32(b, 12);
  const n = u16(b, base + 4);
  for (let i = 0; i < n; i += 1) {
    const rec = base + 12 + i * 16;
    if (b.toString('ascii', rec, rec + 4) === 'cmap') return u32(b, rec + 8);
  }
  return null;
}

/**
 * A `has(codepoint)` probe over one font file, or null when the cmap cannot be read.
 * Segments are searched per lookup rather than expanded into a set: a format-12 font covers
 * hundreds of thousands of codepoints and we only ever ask about a dozen.
 */
export function glyphProbe(file) {
  let b;
  try { b = readFileSync(file); } catch { return null; }
  let cmap;
  try { cmap = cmapOffset(b); } catch { return null; }
  if (cmap == null) return null;

  const subtables = [];
  try {
    const n = u16(b, cmap + 2);
    for (let i = 0; i < n; i += 1) {
      const off = cmap + u32(b, cmap + 4 + i * 8 + 4);
      const fmt = u16(b, off);
      if (fmt === 4 || fmt === 12) subtables.push({ fmt, off });
    }
  } catch { return null; }
  if (!subtables.length) return null;

  const inFmt4 = (off, cp) => {
    if (cp > 0xffff) return false;
    const segX2 = u16(b, off + 6);
    const endO = off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let s = 0; s < segX2 / 2; s += 1) {
      if (u16(b, endO + s * 2) < cp) continue;
      const start = u16(b, startO + s * 2);
      if (start > cp || start === 0xffff) return false;
      const ro = u16(b, rangeO + s * 2);
      if (ro === 0) return ((cp + b.readInt16BE(deltaO + s * 2)) & 0xffff) !== 0;
      const gi = rangeO + s * 2 + ro + (cp - start) * 2;
      return gi + 1 < b.length && u16(b, gi) !== 0;
    }
    return false;
  };
  const inFmt12 = (off, cp) => {
    const groups = u32(b, off + 12);
    for (let g = 0; g < groups; g += 1) {
      const o = off + 16 + g * 12;
      if (u32(b, o) <= cp && cp <= u32(b, o + 4)) return true;
    }
    return false;
  };

  return (cp) => {
    for (const { fmt, off } of subtables) {
      try { if (fmt === 4 ? inFmt4(off, cp) : inFmt12(off, cp)) return true; } catch { /* next */ }
    }
    return false;
  };
}

/**
 * Answers are cached per (file, mtime, script). `fontLibrary()` runs on every settings request and
 * a face is megabytes; the cache holds only the short answer, never the buffer.
 */
const answers = new Map();
const stamp = (file) => {
  try { const st = statSync(file); return `${file}|${st.size}|${st.mtimeMs}`; } catch { return `${file}|0|0`; }
};

/** The probe characters this file cannot draw. Empty means covered; null means unreadable. */
export function missingFor(file, script) {
  const probes = SCRIPT_PROBES[script];
  if (!probes) return [];
  const key = `${stamp(file)}|${script}`;
  if (answers.has(key)) return answers.get(key);
  const has = glyphProbe(file);
  const out = has ? probes.filter((ch) => !has(ch.codePointAt(0))) : null;
  if (answers.size > 512) answers.clear();
  answers.set(key, out);
  return out;
}

/** Every script this file can actually draw — for a font nobody has declared anything about. */
export function scriptsOf(file) {
  return Object.keys(SCRIPT_PROBES).filter((s) => (missingFor(file, s) || []).length === 0);
}

/** Unreadable counts as covered — see the header. */
export function coversScript(file, script) {
  const missing = missingFor(file, script);
  return missing === null || missing.length === 0;
}
