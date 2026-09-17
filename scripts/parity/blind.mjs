// Blind A/B pair builder for the parity DoD: picks N samples from a finished run, takes the
// SAME frame index from ours + ref, shuffles left/right with a seeded PRNG, and writes
// side-by-side JPGs labeled only A/B plus a hidden key file. Judge the pairs visually,
// then read key.json to unblind.
//   node scripts/parity/blind.mjs --run DIR [--n 10] [--seed 7] [--frame 2]
import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RUN = flag('run');
const N = parseInt(flag('n', '10'), 10);
const SEED = parseInt(flag('seed', '7'), 10);
const FRAME = flag('frame'); // fixed frame index; default varies per pair
if (!RUN || !existsSync(RUN)) { console.error('need --run <parity out dir>'); process.exit(2); }

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED);

const samples = readdirSync(RUN).filter((d) => existsSync(join(RUN, d, 'ours_0.jpg')) && existsSync(join(RUN, d, 'ref_0.jpg')));
if (!samples.length) { console.error('no scored samples with both sides in', RUN); process.exit(2); }
// seeded shuffle, take N
for (let i = samples.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [samples[i], samples[j]] = [samples[j], samples[i]]; }
const picked = samples.slice(0, Math.min(N, samples.length));

const outDir = join(RUN, 'blind');
mkdirSync(outDir, { recursive: true });
const key = [];
picked.forEach((label, i) => {
  const fi = FRAME != null ? +FRAME : Math.floor(rng() * 4);
  const ours = join(RUN, label, `ours_${fi}.jpg`);
  const ref = join(RUN, label, `ref_${fi}.jpg`);
  const oursLeft = rng() < 0.5;
  const [L, R] = oursLeft ? [ours, ref] : [ref, ours];
  const out = join(outDir, `pair_${String(i + 1).padStart(2, '0')}.jpg`);
  execFileSync('ffmpeg', ['-v', 'error', '-i', L, '-i', R, '-filter_complex',
    '[0:v]scale=920:-1,drawtext=text=A:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:x=18:y=18[l];' +
    '[1:v]scale=920:-1,drawtext=text=B:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:x=18:y=18[r];' +
    '[l][r]hstack=inputs=2[v]', '-map', '[v]', '-q:v', '3', out, '-y']);
  key.push({ pair: i + 1, label, frame: fi, A: oursLeft ? 'ours' : 'ref', B: oursLeft ? 'ref' : 'ours' });
});
writeFileSync(join(outDir, 'key.json'), JSON.stringify({ seed: SEED, pairs: key }, null, 2));
console.log(`${picked.length} blind pairs → ${outDir} (key.json holds the unblinding)`);
