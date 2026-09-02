// Words that must never become the word on screen.
//
// The beat extractor picks the keyword each animation lands on. It has always filtered English
// and Vietnamese function words — every other language's "and", "the" and "of" sailed straight
// through and could be chosen as the headline of a scene.
//
// The base set is applied to EVERY language on purpose, and always was: a Vietnamese script is
// full of English loanwords and vice versa, so filtering both costs nothing and catches real
// noise. A language's own list is added on top, which leaves the Vietnamese and English lanes
// byte-identical to what shipped.

/** Broad: function words plus content nouns too generic to headline ("cách", "người", "việc"). */
export const STOPWORDS = {
  fr: `le la les un une des du de et ou est sont que qui quoi dans pour avec sur par ce cette ces
       il elle nous vous ils elles son sa ses mon ma mes votre notre au aux en y ne pas plus très
       tout tous toute comme mais donc alors si quand chose fait faire être avoir peut`,
  de: `der die das den dem des ein eine einen einer und oder ist sind war waren dass wenn weil
       mit für von zu im in am an auf aus bei nach über unter durch nicht kein keine auch schon
       noch nur sehr mehr wie was wer wo man sich ich du wir sie es dieser diese dieses`,
  es: `el la los las un una unos unas de del y o que es son era eran para con por en al lo se
       su sus mi mis este esta estos estas como pero si cuando muy mas todo todos toda no ni
       ya hay ser estar hacer cosa forma manera parte vez`,
  pt: `o a os as um uma uns umas de do da dos das e ou que é são era eram para com por em no na
       ao se seu sua seus suas meu este esta estes estas como mas se quando muito mais todo
       todos toda não já há ser estar fazer coisa forma maneira parte vez você`,
  id: `yang dan atau di ke dari pada untuk dengan adalah ini itu ada tidak bukan akan sudah
       telah bisa dapat juga saja hanya lebih paling sangat kita kami saya anda mereka dia
       nya se para oleh sebagai karena jika kalau ketika hal cara orang`,
  ja: `の に は を が と で も や から まで より へ など この その あの どの これ それ あれ
       する した して います ます です ある いる なる こと もの ため よう そして しかし
       また でも つまり つまり さらに とても`,
  ko: `의 가 이 은 는 을 를 에 에서 으로 로 와 과 도 만 부터 까지 하고 그리고 그러나 하지만
       또한 그래서 이런 그런 저런 것 수 때 등 및 위해 통해 대한 하다 있다 되다 없다`,
  zh: `的 了 是 在 和 与 或 也 都 就 还 很 太 更 最 这 那 有 没 不 我 你 他 她 我们 你们
       他们 一个 什么 怎么 因为 所以 但是 如果 可以 能够 需要 通过 对于 关于 而且 然后`,
  th: `และ หรือ ที่ ของ ใน กับ ให้ เป็น คือ จะ ได้ ไม่ มี ไป มา นี้ นั้น อยู่ ก็ แต่ ถ้า
       เพราะ ดังนั้น แล้ว ยัง ต้อง ควร อาจ มาก กว่า เรา คุณ เขา ผม ฉัน`,
  hi: `का की के को में से पर और या है हैं था थे यह वह ये वो एक कोई कुछ सब बहुत ज्यादा कम
       नहीं ना जो जब तब अगर तो लेकिन क्योंकि इसलिए भी ही तक लिए साथ बाद पहले`,
  ru: `и или но а в на с к у за по из от до для что как это тот эта эти был была были быть
       есть не ни же бы уже еще очень более самый мы вы они он она мой ваш наш`,
};

/** Narrower: only true grammatical function words, for the fragment gate. */
export const FUNCTION_WORDS = {
  fr: 'le la les un une des du de et ou que qui dans pour avec sur par ce cette au aux en',
  de: 'der die das den dem des ein eine und oder dass mit für von zu im in am an auf aus bei',
  es: 'el la los las un una de del y o que para con por en al lo se su este esta como',
  pt: 'o a os as um uma de do da dos das e ou que para com por em no na ao se seu este esta',
  id: 'yang dan atau di ke dari pada untuk dengan adalah ini itu se para oleh sebagai karena',
  ja: 'の に は を が と で も や から まで より へ この その あの',
  ko: '의 가 이 은 는 을 를 에 에서 으로 로 와 과 도 만 부터 까지',
  zh: '的 了 是 在 和 与 或 也 都 就 这 那 一个 对于 关于',
  th: 'และ หรือ ที่ ของ ใน กับ ให้ เป็น คือ จะ ก็ แต่',
  hi: 'का की के को में से पर और या है हैं यह वह एक जो',
  ru: 'и или но а в на с к у за по из от до для что как это',
};

/**
 * Words absorbed into a number beat, so "10 lần" and "10 times" stay one on-screen unit.
 * Stored folded (lowercase, diacritics stripped), the way the extractor compares them.
 */
export const NUMBER_UNITS = {
  fr: 'fois pour cent ans annees minutes secondes euros millions milliards',
  de: 'mal prozent jahre minuten sekunden euro millionen milliarden',
  es: 'veces por ciento anos minutos segundos euros millones mil',
  pt: 'vezes por cento anos minutos segundos reais milhoes mil',
  id: 'kali persen tahun menit detik juta miliar ribu rupiah',
  ja: '倍 パーセント 年 分 秒 円 万 億 千',
  ko: '배 퍼센트 년 분 초 원 만 억 천',
  zh: '倍 percent 年 分 秒 元 万 亿 千 百分',
  th: 'เท่า เปอร์เซ็นต์ ปี นาที วินาที บาท ล้าน พัน',
  hi: 'गुना प्रतिशत साल मिनट सेकंड रुपये लाख करोड़ हजार',
  ru: 'раз процент лет года минут секунд рублей миллион тысяч',
};

const split = (s) => String(s || '').split(/\s+/).filter(Boolean);

/** The list for a language, or an empty array — callers add it to their own base set. */
export function stopwordsFor(code) { return split(STOPWORDS[code]); }
export function functionWordsFor(code) { return split(FUNCTION_WORDS[code]); }
export function numberUnitsFor(code) { return split(NUMBER_UNITS[code]); }
