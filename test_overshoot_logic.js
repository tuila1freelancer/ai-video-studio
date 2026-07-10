// Test the overshoot thresholds

function testCurrentLogic(dur, tlDur) {
  const condition = tlDur > dur + 1.5 && tlDur > dur * 1.25;
  return condition;
}

function testProposedLogic1(dur, tlDur) {
  const condition = tlDur > dur + 0.3 && tlDur > dur * 1.15;
  return condition;
}

function testProposedLogic2(dur, tlDur) {
  const condition = tlDur > dur + 0.4;
  return condition;
}

// Test cases
const testCases = [
  { dur: 6, tlDur: 6.4, desc: "0.4s overshoot (6.67%)" },
  { dur: 6, tlDur: 7.2, desc: "1.2s overshoot (20%)" },
  { dur: 6, tlDur: 7.4, desc: "1.4s overshoot (23%) - QA reported case" },
  { dur: 6, tlDur: 7.5, desc: "1.5s overshoot (25%)" },
  { dur: 6, tlDur: 8.5, desc: "2.5s overshoot (42%)" },
  { dur: 6, tlDur: 6.1, desc: "0.1s overshoot (1.67%)" },
  { dur: 6, tlDur: 6.9, desc: "0.9s overshoot (15%)" },
];

console.log("Testing OVERSHOOT threshold logic\n");
console.log("Duration: 6s\n");
console.log("Case | Current (AND: >1.5s && >1.25x) | Proposed1 (AND: >0.3s && >1.15x) | Proposed2 (simple: >0.4s)");
console.log("-----|--------------------------------|----------------------------------|--------------------");

for (const tc of testCases) {
  const c = testCurrentLogic(tc.dur, tc.tlDur);
  const p1 = testProposedLogic1(tc.dur, tc.tlDur);
  const p2 = testProposedLogic2(tc.dur, tc.tlDur);
  
  console.log(`${tc.desc.padEnd(35)} | ${c ? 'FLAG' : 'skip'} | ${p1 ? 'FLAG' : 'skip'} | ${p2 ? 'FLAG' : 'skip'}`);
}

console.log("\n--- Analysis ---");
console.log("dur=6, tlDur=7.4 (23% overshoot - QA case):");
console.log(`  7.4 > 6+1.5? ${7.4 > 7.5} (false) AND 7.4 > 6*1.25? ${7.4 > 7.5} (false) => CURRENT: NOT FLAGGED ❌`);
console.log(`  7.4 > 6+0.3? ${7.4 > 6.3} (true) AND 7.4 > 6*1.15? ${7.4 > 6.9} (true) => PROPOSED1: FLAGGED ✓`);
console.log(`  7.4 > 6+0.4? ${7.4 > 6.4} (true) => PROPOSED2: FLAGGED ✓`);

