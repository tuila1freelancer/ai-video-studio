#!/usr/bin/env node
// The command line an agent (or a cron line, or a person) drives the engine with.
//
//   AVS_URL=https://studio.local AVS_TOKEN=avs_… avs video create --topic "…" --start --wait
//
// Exit codes are the point: 0 fine · 2 the verdict refused · 3 configuration (fix it) ·
// 4 temporary (try again) · 5 budget or quota. A wrapper script can branch on those without
// reading a word of output, which is what --json is for anyway.
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { AvsClient } from '../src/sdk.js';
import { AvsError } from '../src/errors.js';
import { err, json, out, printChannels, printEvent, printOps, printProject, printProjects, printVerdict } from '../src/cli-format.js';

const USAGE = `avs <command>

  health                                  engine, dependencies, ops state
  channels list
  projects list [--channel ID]
  video create --topic TEXT [--channel ID] [--ref REF] [--start] [--wait] [--config JSON]
  video status ID
  video verdict ID [--vision]
  video publish ID [--privacy private|unlisted|public] [--force]
  video stop ID | video resume ID
  topics suggest [--count N] [--niche TEXT] [--channel ID]
  calendar list | calendar plan [--days N] [--per-day N] [--times 08:00,18:00] | calendar cancel ID
  journal tail [--project ID] [--after ID] [--follow]
  usage
  ops status | ops pause [--reason TEXT] | ops drain | ops resume
  file get PATH --out FILE

Everywhere: --json (machine output), --url, --token, --channel (else AVS_URL/AVS_TOKEN/AVS_CHANNEL).
With no --url it finds the running app by itself, whatever port it bound this time.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    json: { type: 'boolean' }, url: { type: 'string' }, token: { type: 'string' }, channel: { type: 'string' },
    topic: { type: 'string' }, ref: { type: 'string' }, config: { type: 'string' }, start: { type: 'boolean' },
    wait: { type: 'boolean' }, vision: { type: 'boolean' }, privacy: { type: 'string' }, force: { type: 'boolean' },
    count: { type: 'string' }, niche: { type: 'string' }, days: { type: 'string' }, 'per-day': { type: 'string' },
    times: { type: 'string' }, project: { type: 'string' }, after: { type: 'string' }, follow: { type: 'boolean' },
    reason: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' },
  },
});

const [group, action, arg] = positionals;
const avs = new AvsClient({ url: values.url, token: values.token, channel: values.channel });
const show = (human, data) => (values.json ? json(data) : human());

async function run() {
  if (values.help || !group) { out(USAGE); return; }
  switch (`${group} ${action || ''}`.trim()) {
    case 'health': {
      const h = await avs.health();
      return show(() => out(`${h.ok ? 'ok' : 'down'}  v${h.version}  mode ${h.mode}  ops ${h.ops}  deps ${Object.entries(h.deps || {}).filter(([, v]) => !v).map(([k]) => `${k}:missing`).join(' ') || 'all present'}`), h);
    }
    case 'channels list': {
      const r = await avs.channels();
      return show(() => printChannels(r.channels), r);
    }
    case 'projects list': {
      const r = await avs.projects({ channel: values.channel });
      return show(() => printProjects(r.projects), r);
    }
    case 'video create': {
      if (!values.topic) throw new AvsError('--topic is required', { code: 'bad_request', status: 400 });
      const created = await avs.createProject({
        topic: values.topic,
        channelId: values.channel,
        clientRef: values.ref,
        config: values.config ? JSON.parse(values.config) : undefined,
      });
      const id = created.project.id;
      if (values.start) await avs.startProject(id);
      const final = values.wait
        ? await avs.waitFor(id, { onEvent: values.json ? undefined : printEvent })
        : created.project;
      return show(() => printProject(final), { project: final, reused: created.reused === true });
    }
    case 'video status': {
      const r = await avs.project(arg);
      return show(() => printProject(r.project), r);
    }
    case 'video verdict': {
      const v = await avs.verdict(arg, { vision: values.vision === true });
      show(() => printVerdict(v), v);
      // The exit code IS the answer: `avs video verdict X && avs video publish X` reads correctly.
      if (!v.publishable) process.exitCode = 2;
      return undefined;
    }
    case 'video publish': {
      const r = await avs.publish(arg, { privacy: values.privacy, force: values.force === true });
      return show(() => out(`published ${r.url || ''} (${r.privacy || values.privacy || 'private'})`), r);
    }
    case 'video stop': return show(() => out('stopping'), await avs.stopProject(arg));
    case 'video resume': return show(() => out('resuming'), await avs.resumeProject(arg));
    case 'topics suggest': {
      const r = await avs.suggestTopics({ count: +values.count || undefined, niche: values.niche || '', channelId: values.channel });
      return show(() => r.topics.forEach((t) => out(`${t.id || ''}  ${t.topic}`)), r);
    }
    case 'calendar list': {
      const r = await avs.calendar();
      return show(() => r.slots.forEach((s) => out(`${s.id}  ${new Date(s.due_at).toISOString()}  ${s.status}  ${s.topic}`)), r);
    }
    case 'calendar plan': {
      const r = await avs.planWeek({
        days: +values.days || undefined,
        perDay: +values['per-day'] || undefined,
        times: values.times ? values.times.split(',') : undefined,
        channelId: values.channel,
      });
      return show(() => out(`planned ${r.slots?.length ?? 0} slot(s)`), r);
    }
    case 'calendar cancel': return show(() => out('cancelled'), await avs.cancelSlot(arg));
    case 'journal tail': {
      let cursor = values.after ? +values.after : (await avs.events({})).lastId;
      do {
        const feed = await avs.events({ after: cursor, project: values.project, wait: values.follow ? 20 : 0 });
        cursor = feed.lastId || cursor;
        if (values.json) json(feed); else feed.events.forEach(printEvent);
      } while (values.follow);
      return undefined;
    }
    case 'usage': {
      const r = await avs.usage();
      return show(() => (r.projects || []).forEach((u) => out(`${u.projectId || u.project_id}  $${Number(u.estCost || 0).toFixed(3)}`)), r);
    }
    case 'ops status': { const r = await avs.ops(); return show(() => printOps(r), r); }
    case 'ops pause': { const r = await avs.pause(values.reason); return show(() => printOps(r), r); }
    case 'ops drain': { const r = await avs.drain(values.reason); return show(() => printOps(r), r); }
    case 'ops resume': { const r = await avs.resume(); return show(() => printOps(r), r); }
    case 'file get': {
      const bytes = await avs.fileBytes(arg);
      if (!values.out) throw new AvsError('--out FILE is required', { code: 'bad_request', status: 400 });
      writeFileSync(values.out, bytes);
      return show(() => out(`${values.out}  ${bytes.length} bytes`), { path: values.out, bytes: bytes.length });
    }
    default:
      out(USAGE);
      process.exitCode = 1;
      return undefined;
  }
}

run().catch((e) => {
  if (values.json) json({ error: e.message, code: e.code || 'request_failed' });
  else err(`✖ ${e.message}${e.code ? `  [${e.code}]` : ''}`);
  process.exit(e instanceof AvsError ? e.exitCode : 1);
});
