// The run's own copy of the config, dressed with the live brand kit, the concat logo (P26) and the watermark (P28).
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { hasDrawtext } from '../../media/ffmpeg.js';
import { resolveConcatLogo } from '../../media/logo-overlay.js';
import { resolveWatermark, watermarkFont } from '../../media/watermark.js';
import { op } from '../progress.js';
import { m } from '../../i18n/t.js';

/**
 * Returns a NEW object: the caller's config is never mutated, so the stages after the join (and
 * the runner's own context) keep seeing what the user configured, not what this join added.
 * @param {{projectId:string, config:object, size:{w:number,h:number}}} args
 */
export async function dressConfig({ projectId, config: given, size }) {
  const config = { ...given };
  // Brand identity is read LIVE from the channel unless this project overrode it. The old
  // behaviour used the snapshot taken when the project was created, which is why turning the
  // logo stamp on or off in the Brand Kit had no effect on anything already made — and why the
  // "Why $5,000" project, created before its channel had a brand kit, would re-concat with no
  // logo at all no matter what the channel said. A project that wants its own identity sets
  // `brandKitOverride: true` when it saves one.
  if (!config.brandKitOverride) {
    const live = DB.channelOf(projectId)?.config?.brandKit;
    if (live) {
      if (JSON.stringify(live) !== JSON.stringify(config.brandKit)) {
        op(projectId, m('🎨 Nhận diện thương hiệu lấy trực tiếp từ kênh (mới hơn bản lưu trong dự án)'));
      }
      config.brandKit = live;
    }
  }
  // Whole-video logo stamp (P26): the ONLY logo lane — burned once at concat in every visual
  // mode. resolveConcatLogo decides from scratch every run, INCLUDING the answer "no logo";
  // the version that lived here could only ever assign one, so the Brand Kit toggle was a
  // one-way switch in practice.
  config.logo = resolveConcatLogo(config, size);
  // Copyright watermark (P28): slow perimeter drift, logo or channel name, whole program.
  // Source degrades sensibly (name without a usable font → logo; logo missing → name).
  const wm = resolveWatermark(config.brandKit?.watermark);
  if (wm && !config.watermark) {
    const bkLogo = config.brandKit?.logo?.assetPath;
    const text = String(config.brandKit?.channelName || '').trim();
    const font = watermarkFont();
    const canText = !!(text && font && await hasDrawtext()); // text lane needs freetype
    if (wm.source === 'logo' && bkLogo) config.watermark = { ...wm, path: bkLogo };
    else if (canText) config.watermark = { ...wm, text, fontFile: font };
    else if (bkLogo) config.watermark = { ...wm, path: bkLogo };
    else logger.warn(m('watermark bật nhưng không có logo lẫn tên kênh khả dụng — bỏ qua'), { projectId });
  }
  return config;
}
