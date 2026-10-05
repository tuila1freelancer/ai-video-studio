// The API: one router per domain under ./routers, mounted here in a fixed order.
//
// The order is load-bearing: the egress translator wraps res.json before any handler writes one,
// and authentication runs before the routes it guards.
import express from 'express';
import * as DB from '../db/index.js';
import { PATHS, depStatus } from '../config/paths.js';
import { maskSecrets } from '../core/config.js';
import { apiAuth } from './middleware/auth.js';
import { idempotency } from './middleware/idempotency.js';
import { t, uiLang } from '../i18n/t.js';
import { codeFor } from '../core/api-codes.js';
import { requestLang } from './request-lang.js';
import { processHealth } from './http.js';
import { mode } from '../core/runtime-mode.js';
import { opsState } from '../ops/state.js';
import { agentMode } from '../ops/agent-mode.js';
import { hostInfo } from '../ops/host-info.js';
import { maskChannel } from './helpers.js';
import { channelIdFor } from './channel-scope.js';
import { buildOpenApi } from './spec/index.js';
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
import { mount as mountEvents } from './routers/events.js';
import { mount as mountOps } from './routers/ops.js';
import { mount as mountTokens } from './routers/tokens.js';
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
    const lang = requestLang(req);
    res.json = (body) => {
      if (body && typeof body === 'object') {
        // The code is read from the UNTRANSLATED text: the Vietnamese sentence is the key here too.
        if (typeof body.error === 'string' && !body.code) body.code = codeFor(body.error, res.statusCode);
        for (const f of ['error', 'message', 'hint']) {
          if (typeof body[f] === 'string') body[f] = t(`srv.${body[f]}`, null, lang);
        }
      }
      return json(body);
    };
    next();
  });

  // WHO is asking (server mode only; a no-op for the desktop app). Registered after the egress
  // translator so its own refusals are translated too, and before every route it guards.
  r.use(apiAuth);

  // After authentication: a refused request is not an answer worth replaying.
  r.use(idempotency);

  r.get('/health', (req, res) => {
    res.json({ ok: true, version, mode: mode(), ops: opsState().state, agent: agentMode().enabled, degraded: processHealth.degraded, deps: depStatus(), paths: {
      ffmpeg: PATHS.ffmpeg, whisper: !!PATHS.whisperCli, chrome: !!PATHS.chrome, say: !!PATHS.say,
    } });
  });
  // Everything the interface needs before its first paint, in one round trip. The boot sequence
  // used to make five of these one after another (settings → health → channels → projects →
  // presets), each a full loopback hop before the next could start.
  r.get('/boot', (req, res) => {
    const active = channelIdFor(req);
    res.json({
      version, uiLang: uiLang(), deps: depStatus(),
      // Where this copy lives, so the Agent panel can print a command with real paths in it. Behind
      // `read` like the rest of /boot — /health stays open, so it is not the place for any of this.
      // `agent` and `budget` ride along because the interface seeds its /settings cache from this
      // reply: seed a shape that is missing them and the panel reads undefined for both.
      agent: agentMode(), budget: DB.getSetting('budget', {}) || {}, host: hostInfo(),
      settings: maskSecrets(DB.aiSettings()),
      channels: DB.listChannels().map(maskChannel), activeChannel: active,
      projects: DB.listProjectSummaries(active),
      presets: DB.listPresets(active),
    });
  });

  // The API describing itself, so an agent can be pointed at a URL rather than a paragraph.
  r.get('/openapi.json', (req, res) => res.json(buildOpenApi({ version })));

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
  mountEvents(r);
  mountOps(r);
  mountTokens(r);
  mountSceneStudio(r);
  mountScenes(r);
  mountResearch(r);
  mountLibraryFonts(r);
  mountBrands(r);
  mountFilesMedia(r);
  mountEditVideo(r);

  app.use('/api', r);
}
