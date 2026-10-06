// Which language THIS reply should speak.
//
// The user's interface language is a property of the installation, not of a request — that has
// always been true and stays true for the app. An agent is a second caller with its own needs: it
// reads the reply itself, so it may ask for English while the user's window stays Vietnamese.
import { isSupported } from '../i18n/languages.js';

/** `?lang=en`, else the first supported Accept-Language, else null (the interface language). */
export function requestLang(req) {
  const asked = String(req?.query?.lang || '').toLowerCase();
  if (isSupported(asked)) return asked;
  for (const part of String(req?.headers?.['accept-language'] || '').split(',')) {
    const code = part.trim().split(';')[0].toLowerCase().slice(0, 2);
    if (isSupported(code)) return code;
  }
  return null;
}
