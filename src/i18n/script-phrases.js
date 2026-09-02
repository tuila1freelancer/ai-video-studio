// Narration the app writes itself, in the language the video is in.
//
// Three places wrote Vietnamese words into the script no matter what language the video was:
// the offline chapter card ("PHẦN 01"), the offline closing call to action, and the placeholder
// line used when a topic yields no usable text. An English video generated without an LLM came
// out with Vietnamese chapter headings and a Vietnamese subscribe line spoken aloud.
//
// The tease-question ban list had the mirror problem: the prompt shipped Vietnamese examples
// ("còn bạn?", "bạn biết chưa?") to every language, which teaches a German model nothing about
// what a German tease-question looks like.

const PHRASES = {
  vi: { chapter: 'PHẦN', part: 'Phần', subscribe: 'Nếu video hữu ích với bạn, hãy đăng ký kênh và bật chuông thông báo để không bỏ lỡ những phần tiếp theo nhé.', subscribeKw: 'đăng ký', teases: '"còn bạn?", "muốn thử không?", "bạn biết chưa?", "điều bất ngờ ở phần sau…"' },
  en: { chapter: 'PART', part: 'Part', subscribe: 'If this was useful, subscribe and turn on notifications so you do not miss what comes next.', subscribeKw: 'subscribe', teases: '"what about you?", "want to try it?", "did you know?", "the surprise is later…", "right?"' },
  fr: { chapter: 'PARTIE', part: 'Partie', subscribe: "Si cette vidéo vous a été utile, abonnez-vous et activez la cloche pour ne rien manquer de la suite.", subscribeKw: 'abonnez', teases: '"et vous ?", "vous voulez essayer ?", "vous saviez ?", "la surprise arrive plus tard…"' },
  de: { chapter: 'TEIL', part: 'Teil', subscribe: 'Wenn dir das Video geholfen hat, abonniere den Kanal und aktiviere die Glocke, damit du nichts verpasst.', subscribeKw: 'abonniere', teases: '"und du?", "willst du es probieren?", "wusstest du das?", "die Überraschung kommt später…"' },
  es: { chapter: 'PARTE', part: 'Parte', subscribe: 'Si el video te sirvió, suscríbete y activa la campana para no perderte lo que viene.', subscribeKw: 'suscríbete', teases: '"¿y tú?", "¿quieres probarlo?", "¿lo sabías?", "la sorpresa viene después…"' },
  pt: { chapter: 'PARTE', part: 'Parte', subscribe: 'Se o vídeo te ajudou, inscreva-se e ative o sininho para não perder o que vem por aí.', subscribeKw: 'inscreva', teases: '"e você?", "quer testar?", "você sabia?", "a surpresa vem depois…"' },
  id: { chapter: 'BAGIAN', part: 'Bagian', subscribe: 'Kalau video ini bermanfaat, subscribe dan nyalakan lonceng supaya tidak ketinggalan bagian berikutnya.', subscribeKw: 'subscribe', teases: '"kamu gimana?", "mau coba?", "sudah tahu belum?", "kejutannya nanti…"' },
  ja: { chapter: '第', part: 'パート', subscribe: '役に立ったら、チャンネル登録と通知をオンにして次回もお見逃しなく。', subscribeKw: 'チャンネル登録', teases: '「あなたはどう？」「試してみたい？」「知ってた？」「驚きは後半で…」' },
  ko: { chapter: '파트', part: '파트', subscribe: '도움이 되셨다면 구독과 알림 설정으로 다음 편도 놓치지 마세요.', subscribeKw: '구독', teases: '"여러분은요?", "해보고 싶으세요?", "알고 계셨나요?", "놀라운 건 뒤에…"' },
  zh: { chapter: '第', part: '第', subscribe: '如果这期视频对你有帮助，记得订阅并打开通知，别错过后面的内容。', subscribeKw: '订阅', teases: '「你呢？」「想试试吗？」「你知道吗？」「惊喜在后面…」' },
  th: { chapter: 'ตอนที่', part: 'ตอนที่', subscribe: 'ถ้าคลิปนี้มีประโยชน์ กดติดตามและเปิดกระดิ่งไว้ จะได้ไม่พลาดตอนต่อไปครับ', subscribeKw: 'ติดตาม', teases: '"แล้วคุณล่ะ?", "อยากลองไหม?", "รู้หรือยัง?", "เซอร์ไพรส์อยู่ตอนหลัง…"' },
  hi: { chapter: 'भाग', part: 'भाग', subscribe: 'अगर यह वीडियो काम आया हो तो चैनल सब्सक्राइब करें और बेल दबाएँ, ताकि अगला हिस्सा छूटे नहीं।', subscribeKw: 'सब्सक्राइब', teases: '"और आप?", "आज़माना चाहेंगे?", "पता था?", "हैरानी आगे है…"' },
  ru: { chapter: 'ЧАСТЬ', part: 'Часть', subscribe: 'Если видео было полезным, подпишитесь и включите уведомления, чтобы не пропустить продолжение.', subscribeKw: 'подпишитесь', teases: '"а вы?", "хотите попробовать?", "знали об этом?", "сюрприз дальше…"' },
};

const FALLBACK = PHRASES.en;

/** One phrase for a language, falling back to English rather than to Vietnamese. */
export function phrase(code, key) {
  return (PHRASES[String(code || '').toLowerCase()] || FALLBACK)[key] || FALLBACK[key];
}

/** The chapter card's spoken heading, e.g. "PHẦN 01" / "PART 01" / "第01". */
export function chapterLabel(code, n) {
  return `${phrase(code, 'chapter')} ${String(n).padStart(2, '0')}`;
}
