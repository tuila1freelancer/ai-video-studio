// Build the parity-sample manifest: scan the reference app's finished sessions and pick a
// representative spread of scenes (category × energy), deterministic given the same data.
//   node scripts/parity/select.mjs [outPath]
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REF_SESSIONS, refPaths, readScript } from './lib.mjs';

const CATS = [
  ['chart', /chart|graph|bar chart|biểu đồ|gauge|meter|sparkline|trend line|line chart|area chart/i],
  ['number', /counter|percent|per cent|%|con số|stat |statistic|number|digit|milestone|\b\d{2,}\b.*(?:glow|hero|big)/i],
  ['node', /node|network|neural|mạng lưới|nơ-?ron|constellation|orbit|graph network|web of/i],
  ['compare', /so sánh|split|versus|\bvs\b|hai bên|hai cột|two column|left.*right.*(?:contrast|compare)|đối lập/i],
  ['card', /card|chat|panel|document|doc |khung|terminal|editor|browser|form|receipt|ticket/i],
];

function categorize(scene, idx, total) {
  const hay = `${scene.visual || ''} ${scene.voice || ''}`;
  if (idx === total - 1 || /đăng ký|subscribe|theo dõi kênh|follow|like và|share/i.test(scene.voice || '')) return 'cta';
  if (idx === 0) return 'hook';
  for (const [cat, re] of CATS) if (re.test(hay)) return cat;
  return 'free';
}

const HIGH = /bùng nổ|tăng vọt|đột phá|kỷ lục|cực kỳ|khủng khiếp|chưa từng|x\d+|shock|sốc/i;
const DRAMATIC = /cảnh báo|nguy hiểm|rủi ro|sập|sụp đổ|mất|lừa|bẫy|sai lầm|thất bại|đáng sợ/i;
const LOW = /giải thích|cách |tại sao|cơ bản|ví dụ|nghĩa là|đơn giản|hãy tưởng tượng|bước /i;
function energy(scene) {
  const t = `${scene.voice || ''}`;
  return HIGH.test(t) ? 'high' : DRAMATIC.test(t) ? 'dramatic' : LOW.test(t) ? 'low' : 'steady';
}

const WANT = { hook: 2, number: 2, chart: 2, node: 2, compare: 2, card: 2, cta: 2, free: 2 };

const sessions = readdirSync(REF_SESSIONS).filter((d) => d.startsWith('sess_')).sort().reverse()
  .filter((sid) => existsSync(refPaths(sid, 1).script) && existsSync(refPaths(sid, 1).video));

const buckets = Object.fromEntries(Object.keys(WANT).map((k) => [k, []]));
for (const sid of sessions) {
  let scenes;
  try { scenes = readScript(sid); } catch { continue; }
  if (!Array.isArray(scenes) || !scenes.length) continue;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const n = s.stt ?? i + 1;
    const p = refPaths(sid, n);
    if (!existsSync(p.video) || !existsSync(p.srt) || !existsSync(p.html)) continue;
    const cat = categorize(s, i, scenes.length);
    buckets[cat].push({ sid, n, cat, energy: energy(s), voice: s.voice, visual: s.visual });
  }
}

// deterministic spread: round-robin over sessions inside each bucket, prefer energy variety
const picked = [];
const usedSess = new Map();
for (const [cat, want] of Object.entries(WANT)) {
  const pool = buckets[cat];
  const seenEnergy = new Set();
  // sort: fewest picks from that session first, then unseen energy first, stable by sid/n
  const rank = (e) => (usedSess.get(e.sid) || 0) * 10 + (seenEnergy.has(e.energy) ? 1 : 0);
  for (let k = 0; k < want && pool.length; k++) {
    pool.sort((a, b) => rank(a) - rank(b) || a.sid.localeCompare(b.sid) || a.n - b.n);
    const e = pool.shift();
    picked.push(e);
    usedSess.set(e.sid, (usedSess.get(e.sid) || 0) + 1);
    seenEnergy.add(e.energy);
  }
}

const out = process.argv[2] || join(process.cwd(), 'tests/fixtures/parity-manifest.json');
writeFileSync(out, JSON.stringify({ createdFrom: 'select.mjs', sessionsDir: '(runtime)', samples: picked }, null, 2));
console.log(`picked ${picked.length} samples across ${new Set(picked.map((p) => p.sid)).size} sessions → ${out}`);
for (const p of picked) console.log(`  ${p.cat.padEnd(7)} ${p.energy.padEnd(8)} ${p.sid}/${p.n}  ${String(p.voice || '').slice(0, 50)}`);
