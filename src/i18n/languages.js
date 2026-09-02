// THE language table. One row per language, one column per per-language constant.
//
// Seven places used to answer "which languages does this app support" and none of them agreed:
// the video picker offered 13, LANG_WPS knew 13, LANG_VOICE_NOTES 11, LANG_FLAGS 10,
// SUPERTONIC_LANGS 9, the subtitle font defaults 3, and detectLang() could only distinguish 6.
// Every layer then invented its own fallback for the rest, so a French video was voiced as
// English, its correct French headlines were flagged as wrong-language, and its breath pad came
// from the Vietnamese branch's `else`. The divergence was the bug; one table is the fix.
//
// Rows are DATA, not behaviour: a consumer reads a column, it does not re-derive the answer.
// tests/i18n-contract.test.js pins that every consumer's coverage equals this table, so an
// eighth definition cannot grow back.

/**
 * @typedef {object} LanguageRow
 * @property {string} code       ISO-639-1
 * @property {string} name       for prompts — a model is told "English (US)", never "en"
 * @property {string} endonym    the language's name in itself, for the UI picker
 * @property {string} flag
 * @property {string} script     matches src/fonts/registry.js SCRIPTS
 * @property {'space'|'intl'} wordMode   'intl' = no spaces between words, needs Intl.Segmenter
 * @property {number} wps        spoken tokens per second (P5: vi 4.4 is measured, not guessed)
 * @property {number} padMs      trailing breath pad after each scene's voice
 * @property {number} lineHeightMin  floor for on-screen text in this script
 * @property {string} numberLocale    BCP47 tag Intl.NumberFormat groups/decimals by
 * @property {'punct'|'intl'} sentenceMode  how sentences are found
 * @property {string[]} connectors   forward connectors the script prompt offers as examples
 * @property {string[]} metaLabels   production-metadata words TTS must never speak
 * @property {?string} voiceNote     narration register/address guidance for the script prompt
 */

/** @type {LanguageRow[]} */
export const LANGUAGES = [
  {
    code: 'vi', name: 'Vietnamese', endonym: 'Tiếng Việt', flag: '🇻🇳',
    script: 'vietnamese', wordMode: 'space', wps: 4.4, padMs: 650,
    lineHeightMin: 1.35, numberLocale: 'vi-VN', sentenceMode: 'punct',
    connectors: ['vì vậy…', 'nhưng…', 'vậy nên…'],
    metaLabels: ['Mô tả video', 'Bình luận ghim'],
    voiceNote: 'Persona: the narrator says "mình", the audience is "các bạn" — never "tôi", never singular "bạn".',
  },
  {
    code: 'en', name: 'English (US)', endonym: 'English', flag: '🇺🇸',
    script: 'latin', wordMode: 'space', wps: 2.6, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'en-US', sentenceMode: 'punct',
    connectors: ['so…', 'but…', 'which is why…'],
    metaLabels: [],
    // English carried no register guidance at all — the one language the old vi/else branch
    // left with nothing. Filled in deliberately rather than left as an accident.
    voiceNote: 'Voice in natural American English, second person — direct and concrete, like a skilled explainer talking to one person.',
  },
  {
    code: 'ja', name: 'Japanese', endonym: '日本語', flag: '🇯🇵',
    script: 'japanese', wordMode: 'intl', wps: 3.4, padMs: 400,
    lineHeightMin: 1.35, numberLocale: 'ja-JP', sentenceMode: 'intl',
    connectors: ['だから…', 'しかし…', 'そのため…'],
    metaLabels: ['説明', '固定コメント'],
    voiceNote: 'Voice in natural Japanese — polite です/ます register, concise sentences that flow for TTS.',
  },
  {
    code: 'ko', name: 'Korean', endonym: '한국어', flag: '🇰🇷',
    script: 'korean', wordMode: 'space', wps: 3.1, padMs: 400,
    lineHeightMin: 1.35, numberLocale: 'ko-KR', sentenceMode: 'punct',
    connectors: ['그래서…', '하지만…', '그렇기 때문에…'],
    metaLabels: ['설명', '고정 댓글'],
    voiceNote: 'Voice in natural Korean — polite 해요체 register, concise spoken sentences.',
  },
  {
    code: 'zh', name: 'Chinese', endonym: '中文', flag: '🇨🇳',
    script: 'cjk-sc', wordMode: 'intl', wps: 3.4, padMs: 400,
    lineHeightMin: 1.35, numberLocale: 'zh-CN', sentenceMode: 'intl',
    connectors: ['所以…', '但是…', '正因如此…'],
    metaLabels: ['描述', '置顶评论'],
    voiceNote: 'Voice in natural Simplified Chinese — clear, friendly presenter tone, short spoken sentences.',
  },
  {
    code: 'ru', name: 'Russian', endonym: 'Русский', flag: '🇷🇺',
    script: 'cyrillic', wordMode: 'space', wps: 2.4, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'ru-RU', sentenceMode: 'punct',
    connectors: ['поэтому…', 'но…', 'вот почему…'],
    metaLabels: ['Описание', 'Закреплённый комментарий'],
    voiceNote: 'Voice in natural Russian — engaging presenter tone, "вы" form, short clear sentences.',
  },
  {
    code: 'fr', name: 'French', endonym: 'Français', flag: '🇫🇷',
    script: 'latin', wordMode: 'space', wps: 4.0, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'fr-FR', sentenceMode: 'punct',
    connectors: ['donc…', 'mais…', "c'est pourquoi…"],
    metaLabels: ['Description', 'Commentaire épinglé'],
    voiceNote: 'Voice in natural French, "vous" form — clear, warm, like a skilled French presenter.',
  },
  {
    code: 'de', name: 'German', endonym: 'Deutsch', flag: '🇩🇪',
    script: 'latin', wordMode: 'space', wps: 3.8, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'de-DE', sentenceMode: 'punct',
    connectors: ['deshalb…', 'aber…', 'genau deswegen…'],
    metaLabels: ['Beschreibung', 'Angehefteter Kommentar'],
    voiceNote: 'Voice in natural German, "Sie" form (formal but approachable) — clear and structured, like a German educational presenter.',
  },
  {
    code: 'es', name: 'Spanish (neutral/Latin American)', endonym: 'Español', flag: '🇪🇸',
    script: 'latin', wordMode: 'space', wps: 4.2, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'es-419', sentenceMode: 'punct',
    connectors: ['por eso…', 'pero…', 'y por eso…'],
    metaLabels: ['Descripción', 'Comentario fijado'],
    voiceNote: 'Voice in natural Spanish (neutral/Latin American), "tú" form — engaging and conversational, like a skilled presenter.',
  },
  {
    code: 'pt', name: 'Portuguese (Brazilian)', endonym: 'Português', flag: '🇧🇷',
    script: 'latin', wordMode: 'space', wps: 4.0, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'pt-BR', sentenceMode: 'punct',
    connectors: ['por isso…', 'mas…', 'é por isso que…'],
    metaLabels: ['Descrição', 'Comentário fixado'],
    voiceNote: 'Voice in natural Brazilian Portuguese, "você" form — conversational and engaging, like a Brazilian YouTuber explaining a topic.',
  },
  {
    code: 'hi', name: 'Hindi', endonym: 'हिन्दी', flag: '🇮🇳',
    // Matras extend far above and below the baseline; 1.8 is the measured floor the codegen
    // prompt has always asked for (hyperframe/prompt.js scriptTextRule).
    script: 'devanagari', wordMode: 'space', wps: 4.2, padMs: 400,
    lineHeightMin: 1.8, numberLocale: 'hi-IN', sentenceMode: 'punct',
    connectors: ['इसलिए…', 'लेकिन…', 'यही वजह है कि…'],
    metaLabels: ['विवरण', 'पिन की गई टिप्पणी'],
    voiceNote: 'Voice in natural Hindi (Hinglish is fine for tech terms) — conversational, like explaining to a friend; mix English tech terms naturally.',
  },
  {
    code: 'th', name: 'Thai', endonym: 'ไทย', flag: '🇹🇭',
    // Thai writes without spaces between words AND without sentence-final punctuation, so both
    // segmenters have to come from ICU rather than from a regex.
    script: 'thai', wordMode: 'intl', wps: 4.0, padMs: 400,
    lineHeightMin: 1.7, numberLocale: 'th-TH', sentenceMode: 'intl',
    connectors: ['ดังนั้น…', 'แต่…', 'เพราะแบบนี้…'],
    metaLabels: ['คำอธิบาย', 'ความคิดเห็นที่ปักหมุด'],
    voiceNote: 'Voice in natural Thai — polite, friendly presenter tone; keep sentences short and rhythmic for TTS.',
  },
  {
    code: 'id', name: 'Indonesian', endonym: 'Indonesia', flag: '🇮🇩',
    script: 'latin', wordMode: 'space', wps: 4.2, padMs: 400,
    lineHeightMin: 1.25, numberLocale: 'id-ID', sentenceMode: 'punct',
    connectors: ['jadi…', 'tapi…', 'makanya…'],
    metaLabels: ['Deskripsi', 'Komentar disematkan'],
    voiceNote: 'Voice in natural Indonesian — friendly, direct presenter tone ("kamu"), short clear sentences.',
  },
];

/** The house language when nothing whatsoever resolves. */
export const DEFAULT_LANG = 'vi';

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Every supported code, in picker order. */
export const LANG_CODES = LANGUAGES.map((l) => l.code);

/** One row, or the default language's row — never undefined, so callers need no guard. */
export function lang(code) {
  return BY_CODE.get(String(code || '').toLowerCase().slice(0, 2)) || BY_CODE.get(DEFAULT_LANG);
}

/** Is this a language the app claims to support? */
export function isSupported(code) { return BY_CODE.has(String(code || '').toLowerCase()); }

/** One column across every row: `{ vi: 4.4, en: 2.6, … }`. */
export function column(field) {
  return Object.fromEntries(LANGUAGES.filter((l) => l[field] != null).map((l) => [l.code, l[field]]));
}
