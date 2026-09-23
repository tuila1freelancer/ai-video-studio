// How the CLI prints things when a person is reading, and how it gets out of the way when a
// program is. `--json` is not a formatting preference: it is the contract a script depends on, so
// nothing else may be written to stdout in that mode.

export const out = (s) => process.stdout.write(`${s}\n`);
export const err = (s) => process.stderr.write(`${s}\n`);
export const json = (v) => out(JSON.stringify(v, null, 2));

const pad = (s, n) => String(s ?? '').padEnd(n);

export function printChannels(list) {
  for (const c of list) out(`${pad(c.id, 22)} ${pad(c.name, 24)} ${c.slug || ''}`);
}

export function printProjects(list) {
  for (const p of list) out(`${pad(p.id, 20)} ${pad(p.status, 9)} ${pad(p.aspect_ratio, 6)} ${String(p.title || '').slice(0, 60)}`);
}

export function printVerdict(v) {
  out(`${v.publishable ? 'PUBLISHABLE' : 'NOT PUBLISHABLE'}  score ${v.score}`);
  for (const r of v.reasons) out(`  ${r.severity === 'blocker' ? '✖' : '·'} ${pad(r.code, 30)} ${r.detail ?? ''}`);
  if (v.cost?.estCost) out(`  cost  $${Number(v.cost.estCost).toFixed(3)} over ${v.cost.calls} call(s)`);
}

export function printEvent(e) {
  const at = new Date(e.at).toISOString().slice(11, 19);
  out(`${at} ${pad(e.level, 7)} ${pad(e.kind, 8)} ${e.projectId ? `${e.projectId.slice(0, 10)} ` : ''}${e.msg}`);
}

export function printOps(s) {
  out(`ops    ${s.ops.state}${s.ops.reason ? ` (${s.ops.reason})` : ''}${s.ops.by ? ` by ${s.ops.by}` : ''}`);
  out(`jobs   ${s.jobs.queued} queued, ${s.jobs.running} running`);
}

export function printProject(p) {
  out(`${p.id}  ${p.status}${p.current_step ? ` @${p.current_step}` : ''}`);
  out(`title  ${p.title || ''}`);
  if (p.video_path) out(`video  ${p.video_path}`);
  if (p.error) out(`error  ${p.error}`);
}
