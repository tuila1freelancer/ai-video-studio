// Normalized, cached voice catalog across providers. Keyless/offline providers are listed
// by default; each provider's list is refreshed at most once a day (or on ?refresh).
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { listVoices as saySystemVoices } from '../../media/say.js';

const DEFAULT_PROVIDERS = ['edge', 'say', 'vbee', 'larvoice']; // keyless/offline catalogs by default

/**
 * Which providers the PLAIN catalog call loads. The UI renders one chip per REGISTERED provider,
 * so a provider missing from this list renders a chip that filters to an empty list — measured:
 * ElevenLabs / OpenAI / Supertonic each showed 0 voices while their chip sat there looking live.
 * A provider is included when its catalog costs nothing to fetch (local or keyless) OR when the
 * owner has actually configured a key for it — a keyed provider with no key is the one case
 * where staying out is right, and the UI drops its chip instead of showing an empty list.
 */
export function catalogProviders(ttsSettings, listProviders, providerConfig) {
  return listProviders()
    .filter((p) => {
      if (DEFAULT_PROVIDERS.includes(p.id)) return true;
      if (!p.needsNetwork) return true; // local engine (supertonic, say) — its roster is built in
      const cfg = providerConfig(ttsSettings, p.id) || {};
      return !!(cfg.apiKey || cfg.token); // keyed cloud provider: only once a key exists
    })
    .map((p) => p.id);
}
const CACHE_TTL_MS = 24 * 3600 * 1000;

/**
 * @param {{provider?:string, lang?:string, q?:string, refresh?:boolean}} query
 * @returns {Promise<{voices:object[], providers:object[], say:object[]}>}
 */
export async function getVoiceCatalog({ provider, lang, q, refresh } = {}) {
  const { listProviders, getProvider, providerConfig } = await import('../../providers/voice/index.js');
  const providers = listProviders();
  let voices = [];
  const tts = DB.aiSettings().tts;
  const wanted = provider ? [provider] : catalogProviders(tts, listProviders, providerConfig);
  for (const p of wanted) {
    const prov = getProvider(p);
    try {
      if (DB.voicesCacheAge(p) > CACHE_TTL_MS || refresh) {
        const cfg = providerConfig(DB.aiSettings().tts, p);
        DB.cacheVoices(p, await prov.listVoices(cfg));
      }
      voices.push(...DB.cachedVoices(p));
    } catch (e) { logger.warn(`listVoices ${p}: ${e.message}`); }
  }
  if (lang) voices = voices.filter((v) => v.lang === lang || v.lang === 'multi');
  if (q) { const needle = String(q).toLowerCase(); voices = voices.filter((v) => v.name.toLowerCase().includes(needle) || v.id.toLowerCase().includes(needle)); }
  // legacy shape for the old settings dropdown
  return { voices, providers, say: await saySystemVoices() };
}
