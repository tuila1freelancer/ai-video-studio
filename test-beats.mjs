// Test case for punctuation-only beat issue
import { extractBeats } from './src/hyperframe/beats.js';

// Test 1: punctuation-only phrase
const srtJson1 = [
  {
    start: 0.5,
    end: 1.0,
    text: "...",
    words: [
      { start: 0.5, end: 1.0, word: "..." }
    ]
  }
];

const result1 = extractBeats(srtJson1, [], 6);
console.log("Test 1 - Punctuation only ('...'):");
console.log("  Input: one word '...'");
console.log("  Result beats:", result1.length > 0 ? result1 : "(empty array)");
console.log("  Result text values:", result1.map(b => `"${b.text}"`).join(", ") || "(no beats)");
console.log();

// Test 2: keyword extracted from punctuation
const srtJson2 = [
  {
    start: 0.5,
    end: 1.5,
    text: "**important** ... concept",
    words: [
      { start: 0.5, end: 0.9, word: "**important**" },
      { start: 1.0, end: 1.1, word: "..." },
      { start: 1.2, end: 1.5, word: "concept" }
    ]
  }
];

const result2 = extractBeats(srtJson2, ["important"], 6);
console.log("Test 2 - Keyword with punctuation:");
console.log("  Input: '**important**', '...', 'concept' (keyword: important)");
console.log("  Result beats:", result2.length);
console.log("  Result text values:", result2.map(b => `"${b.text}"`).join(", "));
console.log("  Result kinds:", result2.map(b => `${b.kind}`).join(", "));
