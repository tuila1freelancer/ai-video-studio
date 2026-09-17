// The API: one router per domain under ./routers, mounted here in a fixed order.
//
// The order is load-bearing in two places: the licence gate is registered before any route so a
// route added tomorrow is covered by default, and /health sits right after it because it is the
// one thing a locked copy may still answer.
import express from 'express';
import * as DB from '../db/index.js';
import { PATHS, depStatus } from '../config/paths.js';
import { maskSecrets } from '../core/config.js';
import { licenseGate } from '../license/gate.js';
import { t, uiLang } from '../i18n/t.js';
import { processHealth } from './http.js';
import { maskChannel } from './helpers.js';
import { mount as mountLicense } from './routers/license.js';
import { mount as mountSettingsProviders } from './routers/settings-providers.js';
import { mount as mountStyles } from './routers/styles.js';
import { mount as mountChannels } from './routers/channels.js';
import { mount as mountProjects } from './routers/projects.js';
import { mount as mountProjectExports } from './routers/project-exports.js';
import { mount as mountPipeline } from './routers/pipeline.js';
import { mount as mountJournalUsage } from './routers/journal-usage.js';
import { mount as mountAssistantCalendar } from './routers/assistant-calendar.js';
import { mount as mountPublish } from './routers/publish.js';
import { mount as mountProjectOutputs } from './routers/project-outputs.js';
import { mount as mountJobs } from './routers/jobs.js';
import { mount as mountSceneStudio } from './routers/scene-studio.js';
import { mount as mountScenes } from './routers/scenes.js';
import { mount as mountResearch } from './routers/research.js';
import { mount as mountLibraryFonts } from './routers/library-fonts.js';
import { mount as mountBrands } from './routers/brands.js';
import { mount as mountEditVideo } from './routers/edit-video.js';
import { mount as mountFilesMedia } from './routers/files-media.js';

export { syncLlmAccounts } from '../core/llm-accounts.js';

export function mountRoutes(app, { version }) {
  const r = express.Router();

  // Every user-facing string in a reply, translated on the way out.
  //
  // `{ error: 'cảnh chưa có audio' }` is rendered verbatim as a toast, and there are 58 of them
  // written across a dozen files. Rewriting all 58 to pass a key would buy nothing this does not:
  // the Vietnamese string IS the key, so no call site changes, an unkeyed string still shows its
  // Vietnamese, and adding a translation later needs no code at all. Only these three fields are
  // touched — a reply's DATA is never language.
  r.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === 'object') {
        for (const f of ['error', 'message', 'hint']) {
          if (typeof body[f] === 'string') body[f] = t(`srv.${body[f]}`, null);
        }
      }
      return json(body);
    };
    next();
  });

  // FIRST, before any route: an unlicensed copy answers 403 everywhere except /health and
  // /license/*. Mounting it here rather than decorating routes means a route added tomorrow is
  // covered by default instead of by memory.
  r.use(licenseGate);

  r.get('/health', (req, res) => {
    res.json({ ok: true, version, degraded: processHealth.degraded, deps: depStatus(), paths: {
      ffmpeg: PATHS.ffmpeg, whisper: !!PATHS.whisperCli, chrome: !!PATHS.chrome, say: !!PATHS.say,
    } });
  });
  // Everything the interface needs before its first paint, in one round trip. The boot sequence
  // used to make six of these one after another (license → settings → health → channels →
  // projects → presets), each a full loopback hop before the next could start.
  r.get('/boot', (req, res) => {
    const active = DB.activeChannelId();
    res.json({
      version, uiLang: uiLang(), deps: depStatus(),
      settings: maskSecrets(DB.aiSettings()),
      channels: DB.listChannels().map(maskChannel), activeChannel: active,
      projects: DB.listProjectSummaries(active),
      presets: DB.listPresets(active),
    });
  });

  mountLicense(r);
  mountSettingsProviders(r);
  mountStyles(r);
  mountChannels(r);
  mountProjects(r);
  mountProjectExports(r);
  mountPipeline(r);
  mountJournalUsage(r);
  mountAssistantCalendar(r);
  mountPublish(r);
  mountProjectOutputs(r);
  mountJobs(r);
  mountSceneStudio(r);
  mountScenes(r);
  mountResearch(r);
  mountLibraryFonts(r);
  mountBrands(r);
  mountFilesMedia(r);
  mountEditVideo(r);

  app.use('/api', r);
}
