// Symbols a neural voice reads wrong, expanded per language — for the SYNTHESIZER only.
//
// The captions keep the original script (digits stay on screen), and the forced-alignment engine
// bridges the gap: the caption word "85%" simply spans the spoken expansion's time.
//
// Deliberately narrow. Modern neural voices read plain numbers well in every language here, so
// expanding them would make the narration worse, not better. What they reliably get wrong is
// SYMBOLS and AMBIGUOUS FORMS — a bare "%", a "16:9" read as a clock time, a d/m/y date read in
// the American order. Those are the only things below.
//
// A language with no entry is left alone, which is the correct behaviour and was also the old
// one — the difference is that it is now a missing row rather than `if (lang === 'vi')`.

const DMY = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;   // 15/3/2025 — day first outside the US
const RATIO = /\b(\d{1,2}):(\d{1,2})\b/g;           // 16:9 — a clock time to every voice that reads it
// The WHOLE number, not its last digit: Chinese puts the number after 百分之, so a rule that
// captured one digit turned 85% into 8百分之5. Capturing the number is identical for the
// languages that put it first.
const PCT = /(\d+(?:[.,]\d+)?)\s?%/g;

export const TTS_RULES = {
  vi: [
    [DMY, '$1 tháng $2 năm $3'],
    [PCT, '$1 phần trăm'],
    // \b is ASCII-only in JS, so 'đ/Đ' endings need an explicit Unicode lookahead
    [/(\d)\s?(?:VNĐ|VND)(?![\p{L}\p{N}])/giu, '$1 đồng'],
    [/(\d)\s?đ(?![\p{L}\p{N}])/gu, '$1 đồng'],
    [/\$\s?(\d[\d.,]*)/g, '$1 đô la'],
    [/(\d)\s?°C\b/g, '$1 độ C'],
    [/(\d)\s?km\/h\b/gi, '$1 ki lô mét một giờ'],
    [/(\d)\s?m2\b/gi, '$1 mét vuông'],
    [RATIO, '$1 trên $2'],
  ],
  en: [
    // Month first, because an English script that writes 15/3 means the 15th and the voice does not.
    [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, '$2/$1/$3'],
    [PCT, '$1 percent'],
    [RATIO, '$1 to $2'],
    [/(\d)\s?°C\b/g, '$1 degrees Celsius'],
    [/(\d)\s?km\/h\b/gi, '$1 kilometres per hour'],
  ],
  fr: [[DMY, '$1 $2 $3'], [PCT, '$1 pour cent'], [RATIO, '$1 sur $2'], [/(\d)\s?°C\b/g, '$1 degrés Celsius']],
  de: [[DMY, '$1.$2.$3'], [PCT, '$1 Prozent'], [RATIO, '$1 zu $2'], [/(\d)\s?°C\b/g, '$1 Grad Celsius']],
  es: [[DMY, '$1 de $2 de $3'], [PCT, '$1 por ciento'], [RATIO, '$1 a $2'], [/(\d)\s?°C\b/g, '$1 grados Celsius']],
  pt: [[DMY, '$1 de $2 de $3'], [PCT, '$1 por cento'], [RATIO, '$1 para $2'], [/(\d)\s?°C\b/g, '$1 graus Celsius']],
  id: [[DMY, '$1 $2 $3'], [PCT, '$1 persen'], [RATIO, '$1 banding $2']],
  ru: [[DMY, '$1.$2.$3'], [PCT, '$1 процентов'], [RATIO, '$1 к $2']],
  ja: [[DMY, '$3年$2月$1日'], [PCT, '$1パーセント'], [RATIO, '$1対$2']],
  ko: [[DMY, '$3년 $2월 $1일'], [PCT, '$1 퍼센트'], [RATIO, '$1 대 $2']],
  zh: [[DMY, '$3年$2月$1日'], [PCT, '百分之$1'], [RATIO, '$1比$2']],
  th: [[DMY, '$1/$2/$3'], [PCT, '$1 เปอร์เซ็นต์'], [RATIO, '$1 ต่อ $2']],
  hi: [[DMY, '$1/$2/$3'], [PCT, '$1 प्रतिशत'], [RATIO, '$1 और $2']],
};

/** The expansion rules for a language, or an empty list — never another language's rules. */
export function rulesFor(code) { return TTS_RULES[String(code || '').toLowerCase()] || []; }
