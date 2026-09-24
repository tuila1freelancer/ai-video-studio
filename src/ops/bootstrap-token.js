// The first token, for a deployment where nobody can reach the machine to mint one.
//
// A container refuses to start in server mode with no token — which is right, and leaves a chicken
// and an egg: the database lives inside the volume, so `npm run token` has nowhere to run. Setting
// AVS_BOOTSTRAP_TOKEN_NAME mints exactly one, on a database that has none, and logs it once.
//
// That is the "initial admin password" pattern, with its one rule stated out loud: the log is not a
// safe place for a credential, so this token is for the first connection and should be replaced.
import { countApiTokens, createApiToken } from '../db/index.js';
import { logger } from '../util/log.js';

/** @returns {string|null} the token that was minted, or null when nothing was needed or asked for. */
export function bootstrapToken(env = process.env) {
  const name = env.AVS_BOOTSTRAP_TOKEN_NAME || env.AVS_BOOTSTRAP_TOKEN;
  if (!name) return null;
  if (countApiTokens() > 0) return null;
  const scopes = String(env.AVS_BOOTSTRAP_SCOPES || 'read,produce,publish').split(',').map((s) => s.trim()).filter(Boolean);
  const made = createApiToken({ name: String(name).slice(0, 80) || 'bootstrap', scopes });
  logger.warn(`API token đầu tiên (${made.name}): ${made.token}`);
  logger.warn('Token này nằm trong log — dùng để kết nối lần đầu, sau đó tạo token mới và thu hồi nó.');
  return made.token;
}
