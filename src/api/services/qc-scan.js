// Read a finished project back and report what a human would not catch.
//
// This started as a one-off repair script. It became a feature because of what it found: the
// database said a scene was English while the clip on disk was still Vietnamese — a stale render
// that every metadata check in the app agreed was fine. The lesson was to verify by artifact, not
// by row, and that is the check this exists to make routine.
//
// It reports. It never edits. A scan that quietly "fixed" things would put the owner back where
// they started: unable to tell what the video actually contains.
import { existsSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { renderCurrent } from '../../pipeline/fingerprint.js';
import { textLanguageLeak, narrationWordSet } from '../../hyperframe/validate.js';
import { resolveLang, langName } from '../../util/lang.js';

/** Number and currency conventions that betray a different locale than the narration. */
const VI_NUMBER = /\b\d{1,3}(?:\.\d{3})+\s*(?:đ|vnđ|vnd|tr|triệu|tỷ)?\b|\bđ\b|\bvnđ\b|\btriệu\b|\btỷ\b/i;
const EN_NUMBER = /\$\s?\d|\b\d{1,3}(?:,\d{3})+\b/;

/** Every text node the codegen spec puts on screen. */
function textsOf(scene) {
  const out = [];
  const walk = (node) => {
    if (typeof node === 'string') { const t = node.trim(); if (t) out.push(t); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(scene.props?.html || scene.props || null);
  return out;
}

// The crude >…< sweep also catches CSS tails and entity padding; those carry no word and
// then read as a foreign language. Keep only captures with an actual letter or digit.
function screenText(scene) {
  const html = typeof scene.props?.html === 'string' ? scene.props.html : '';
  return [...html.matchAll(/>([^<>{}]{2,})</g)]
    .map((m) => m[1].replace(/&[a-z]+;|&#\d+;/gi, ' ').trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}

// Slots that are SUPPOSED to hold a word. The templates are full of deliberately empty
// decorative boxes — orbs, grids, fill bars — so flagging every empty tag fired on 101 of 101
// scenes, which is the same as reporting nothing at all.
const TEXT_SLOT = /\b(label|title|text|kicker|caption|name|head|lbl|val|kw|tag|quote|stat)\b/i;
export function blankedLabel(html) {
  for (const m of String(html || '').matchAll(/<(span|div|p|h[1-6])([^>]*)><\/\1>/g)) {
    if (TEXT_SLOT.test(m[2])) return true;
  }
  return false;
}

/**
 * @returns {{lang:string, scenes:number, findings:Array<{sceneIdx:number, kind:string, detail:string}>}}
 */
export function qcScan(projectId) {
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const config = project.config || {};
  const scenes = DB.getScenes(projectId).sort((a, b) => a.idx - b.idx);
  const lang = resolveLang(config, scenes);
  const findings = [];
  const add = (scene, kind, detail) => findings.push({ sceneIdx: scene.idx + 1, sceneId: scene.id, kind, detail });

  for (const scene of scenes) {
    // 1. THE important one: does the clip on disk still match the design in the database?
    //    A stale clip is invisible to every other check in the app — it was the failure that
    //    made this module exist.
    if (scene.video_path) {
      if (!existsSync(scene.video_path)) {
        add(scene, 'clip-missing', 'clip đã biến mất khỏi đĩa');
      } else if (!renderCurrent(scene, { config, project }, config).ok) {
        add(scene, 'clip-stale', 'clip trên đĩa KHÔNG khớp thiết kế hiện tại — cần render lại');
      }
    } else if (scene.audio_path) {
      add(scene, 'clip-missing', 'chưa có clip cho cảnh này');
    }

    // 2. On-screen text in a language the narration is not in.
    // textLanguageLeak wants the folded word SET, not the raw narration — passing the string
    // threw on every call, so this whole check has never once run.
    const narrWords = narrationWordSet(scene.voice_text);
    for (const t of narrWords ? screenText(scene) : []) {
      if (textLanguageLeak(t, narrWords, lang)) {
        add(scene, 'wrong-language', `chữ trên màn có vẻ không phải ${langName(lang)}: "${t.slice(0, 40)}"`);
        break; // one report per scene is enough to send the owner to look
      }
    }

    // 3. Number and currency conventions from the wrong locale. Reported, never rewritten:
    //    "84.000.000 đ" in an English video is usually wrong and occasionally deliberate.
    const all = screenText(scene).join(' ');
    if (lang !== 'vi' && VI_NUMBER.test(all)) {
      add(scene, 'number-locale', 'số/tiền tệ đang theo quy ước tiếng Việt');
    } else if (lang === 'vi' && EN_NUMBER.test(all)) {
      add(scene, 'number-locale', 'số/tiền tệ đang theo quy ước tiếng Anh');
    }

    // 4. A label the spec sanitiser blanked out — an empty box where a word should be.
    if (blankedLabel(scene.props?.html)) {
      add(scene, 'empty-label', 'có nhãn bị xoá trắng trong thiết kế');
    }

    // 5. Voice in a different language from the video's.
    if (scene.voice_text && textsOf(scene).length === 0 && !scene.props) {
      add(scene, 'no-design', 'cảnh chưa có thiết kế hình');
    }
  }
  return { lang, scenes: scenes.length, findings };
}
