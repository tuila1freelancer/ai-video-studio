// Value-and-policy audit for an English narration script (deterministic, no LLM, no I/O).
// YouTube's 2026 "inauthentic content" clarification demonetises three things a synthetic-voice
// channel slides into without noticing: templated videos that feel the same in a row, videos
// that promise and never pay, and an AI voice acting as a financial expert handing out advice.
// The channel's prompt (PROMPT MASTER v2) turns those into measurable terms; this module measures
// them so a script is gated on numbers, not on how it reads.

const SENTENCE_RE = /[^.!?]+[.!?]+["')]?/g;
const NUM_RE = /[$€£]?\d[\d,]*(?:\.\d+)?(?:[KMBT](?![a-z]))?%?/g;

const SOURCE_RES = [
  /bureau of labor statistics|\bbls\b/i, /federal reserve|the fed's|the fed\b/i, /census/i, /\bkff\b|kaiser/i,
  /10-k|annual report|quarterly report|earnings call|filing/i, /\biata\b/i, /\bfico\b|myfico/i, /\bcfpb\b|consumer financial protection/i,
  /social security administration|\bssa\b|trustees report/i, /\bcms\b|medicare\.gov/i, /\birs\b/i, /bank of england/i, /\bfdic\b/i,
  /zillow|redfin|freddie mac|fannie mae/i, /\bnber\b|\bcbo\b|treasury|bureau of economic analysis|\bbea\b/i,
  /according to|published by|survey (?:found|says|shows)|report (?:found|says|shows)|its own (?:filings|numbers|survey|report)/i,
];
const CALC_RE = /\b(divide|divided by|subtract|multiply|multiplied|add (?:it|them|that) up|add up|times|plus|minus|equals|you get|comes to|works out to|break-?even|percent of)\b/i;
const CHECK_RE = /\b(check|compare|multiply|look up|find (?:the|your)|open your|pull (?:your|the)|run (?:the|this|it)|subtract|divide|add up|read the|count|measure|ask (?:for|your))\b/i;
const MECHANISM_RE = /\b(i call (?:it|this|the)|call (?:it|this) the|is called|known as|that's the mechanism|the mechanism is)\b/i;
const ANSWER_RE = /\b(the answer is|so the answer|that's the mechanism|here's the mechanism|that's the whole (?:trick|mechanism|machine)|the short answer|the honest answer|in one sentence|that's why)\b/i;

const PERSONA_RES = [
  /\bas an? (?:financial )?(?:advisor|adviser|analyst|planner|accountant|economist|banker|trader|expert)\b/i,
  /\b(?:in|over|after) my (?:\d+ |ten |twenty |fifteen )?years\b/i, /\bmy clients?\b/i, /\bwhen i (?:worked|was) (?:at|in|a)\b/i,
  /\bi(?:'ve| have) been (?:where you are|broke|there)\b/i, /\bi used to be\b/i, /\bi (?:bought|sold|invested|own|owned)\b/i,
  /\bmy (?:portfolio|rent|mortgage|paycheck|salary|401k|savings)\b/i, /\bi know a (?:guy|woman|man|couple)\b/i,
  /\ba friend of mine\b/i, /\bone of my (?:viewers|readers|subscribers)\b/i,
];
const ADVICE_RES = [
  /\byou (?:should|need to|must|have to|ought to)\b/i, /\bmake sure (?:you|to)\b/i, /\bi recommend\b/i, /\bmy advice\b/i,
  /\bthe best (?:move|thing to do|investment|option) is\b/i,
  // "Buy a $400 ticket and the airline keeps $4.50" is a scenario; "you should buy" is advice
  /\b(?:you (?:should|need to|could|might want to)|just|go|i'd|i would) (?:buy|sell)\b/i,
  /\binvest in\b/i, /\bput your (?:money|cash|savings) (?:in|into)\b/i, /\bmove your (?:money|cash|savings)\b/i,
  /\bopen an? (?:account|hysa|ira|roth)\b/i, /\bswitch to\b/i, /(?<!don't |never |not )\bmax out\b/i, /\bpay off .{0,20} first\b/i,
];
const FEAR_RES = [
  /\bcollapse\b/i, /\bcrash is coming\b/i, /\byou(?:'ll| will) lose everything\b/i, /\bit's (?:already )?too late\b/i,
  /\bthey don't want you to know\b/i, /\bbefore it's too late\b/i, /\bwake up\b/i, /\bnobody is safe\b/i, /\bbefore (?:january|february|march|april|may|june|july|august|september|october|november|december) \d/i,
];
const FILLER_RES = [
  /\bdelve\b/i, /\bdive (?:in|into)\b/i, /in today's (?:fast-paced )?(?:world|economy)/i, /it's important to (?:note|remember)/i,
  /\bthat being said\b/i, /\bmoreover\b|\bfurthermore\b|\badditionally\b/i, /\bgame-?changer\b/i, /\bunlock\b/i, /navigate the complexities/i,
  /a testament to/i, /let's break it down/i, /\bcrucial\b|\brobust\b|\bmyriad\b/i, /at the end of the day/i,
  /in this video,? we/i, /without further ado/i, /smash that like/i, /\bstay tuned\b|\bstick around\b/i, /\bhey guys\b/i,
  /\bguaranteed\b|\brisk-free\b|\bsecret\b|\bget rich\b|\bto the moon\b/i,
  /this video answers one question/i, /that's not the part that surprised me/i, /so who wins in this system/i,
  /so what do you actually do with this/i, /here's what i want you to take with you/i, /\bhold that thought\b/i, /\bstay with me\b|\bstick with me\b/i,
];
const CONNECTIVES = [
  'look —', "here's the thing.", 'and honestly?', "so here's where it gets interesting.", "i'll be straight with you.",
  'picture this.', 'look at this chart.', 'watch what happens when', "let's put a number on that.", 'two things are true at once.',
  'sound familiar?', 'see the gap?', "that's the whole trick.",
];
export const CLOSING_LINE = 'if this made the numbers a little clearer, subscribe. thanks for watching.';
// The spoken disclosure is fixed wording too — YouTube allows an identical intro/outro, and a
// one-sentence "not advice" line is the same kind of furniture. Everything else must differ.
export const DISCLOSURE_LINE = "nothing here is advice. it's math you can check yourself, from the sources in the description. what you do with it is your call, ideally with someone licensed.";
const FIXED_LINES = [CLOSING_LINE, DISCLOSURE_LINE];

const norm = (s) => String(s || '').toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const sentences = (text) => (String(text || '').match(SENTENCE_RE) || []).map((s) => s.trim()).filter(Boolean);
const hits = (text, res) => res.flatMap((re) => { const m = String(text || '').match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')); return m ? m.map((x) => x.trim()) : []; });

/**
 * @param {string} text narration
 * @param {{title?:string, corpus?:string[]}} opts corpus[0] = the previous video's narration
 */
export function auditScript(text, { title = '', corpus = [] } = {}) {
  const t = String(text || '');
  const words = t.split(/\s+/).filter(Boolean).length;
  const sents = sentences(t);
  const numbers = (t.match(NUM_RE) || []).length;
  const per100 = words ? +(numbers / words * 100).toFixed(2) : 0;
  const sourcesSpoken = sents.filter((s) => SOURCE_RES.some((re) => re.test(s))).length;
  const workedExample = sents.filter((s) => CALC_RE.test(s) && NUM_RE.test(s)).length;
  const tail = sents.slice(Math.floor(sents.length * 0.6));
  const checks = tail.filter((s) => CHECK_RE.test(s) && /\d|percent/.test(s)).length;
  const mechanismNamed = MECHANISM_RE.test(t);
  // where the script first commits to an answer, as a fraction of its length
  let answerAt = null;
  { let seen = 0; for (const s of sents) { seen += s.split(/\s+/).length; if (ANSWER_RE.test(s)) { answerAt = +(seen / Math.max(1, words)).toFixed(2); break; } } }
  const titleWords = norm(title).match(/[a-z][a-z']{3,}/g) || [];
  const head = norm(t.split(/\s+/).slice(0, Math.ceil(words * 0.25)).join(' '));
  const titleCoverage = titleWords.length ? +(titleWords.filter((w) => head.includes(w)).length / titleWords.length).toFixed(2) : null;
  const persona = hits(t, PERSONA_RES), advice = hits(t, ADVICE_RES), fear = hits(t, FEAR_RES), filler = hits(t, FILLER_RES);
  // template fingerprints: sentences shared verbatim with another script, connectives reused
  const own = new Set(sents.map(norm).filter((s) => s.split(' ').length >= 6 && !FIXED_LINES.some((f) => f.includes(s))));
  const crossRepeats = [];
  for (const other of corpus) for (const s of new Set(sentences(other).map(norm))) if (own.has(s) && !crossRepeats.includes(s)) crossRepeats.push(s);
  const nt = norm(t), prev = norm(corpus[0] || '');
  const connectiveReuse = CONNECTIVES.filter((c) => nt.split(c).length - 1 > 1);
  const connectiveFromPrevious = prev ? CONNECTIVES.filter((c) => nt.includes(c) && prev.includes(c)) : [];
  const closingOk = nt.includes(CLOSING_LINE);
  const fails = [];
  if (words < 1300) fails.push(`words ${words} < 1300`);
  if (per100 < 1.8) fails.push(`numbers ${per100}/100w < 1.8`);
  if (sourcesSpoken < 3) fails.push(`sources spoken ${sourcesSpoken} < 3`);
  if (workedExample < 1) fails.push('no spoken calculation');
  if (checks < 3) fails.push(`checks ${checks} < 3`);
  if (answerAt == null) fails.push('no explicit answer sentence');
  else if (answerAt > 0.35) fails.push(`answer at ${Math.round(answerAt * 100)}% > 35%`);
  if (persona.length) fails.push(`persona: ${persona.join(' | ')}`);
  if (advice.length) fails.push(`advice: ${advice.join(' | ')}`);
  if (fear.length) fails.push(`fear: ${fear.join(' | ')}`);
  if (filler.length > 2) fails.push(`filler ${filler.length} > 2: ${filler.slice(0, 4).join(' | ')}`);
  if (crossRepeats.length) fails.push(`${crossRepeats.length} sentence(s) shared with another script`);
  if (connectiveReuse.length) fails.push(`connective used twice: ${connectiveReuse.join(' | ')}`);
  if (connectiveFromPrevious.length) fails.push(`connective also in previous video: ${connectiveFromPrevious.join(' | ')}`);
  if (!closingOk) fails.push('fixed closing line missing');
  return {
    words, minutes: +(words / 156).toFixed(1), numbers, per100, sourcesSpoken, workedExample, checks, mechanismNamed,
    answerAt, titleCoverage, persona, advice, fear, filler, crossRepeats, connectiveReuse, connectiveFromPrevious, closingOk,
    fails, ok: fails.length === 0,
  };
}
