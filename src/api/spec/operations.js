// The agent-facing surface, declared once.
//
// Not every route: 178 of them exist and most belong to the interface. These are the ones an agent
// is expected to drive, and the test keeps every entry honest — a path here that the router does not
// mount, or a code that the error table does not know, is a failing test rather than a wrong promise.
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (name) => ({ type: 'array', items: ref(name) });
const channelParam = {
  name: 'channel', in: 'query', required: false, schema: { type: 'string' },
  description: 'Channel id. Also accepted as X-AVS-Channel or body.channelId. Defaults to the token’s channel, then the active one.',
};

/** @type {Record<string, {summary:string, tags:string[], query?:object[], body?:object, reply?:object, codes?:string[]}>} */
export const OPERATIONS = {
  'GET /health': {
    summary: 'Liveness, dependency status and the ops state. Open — no token needed.',
    tags: ['ops'],
    reply: { type: 'object', properties: { ok: { type: 'boolean' }, version: { type: 'string' }, mode: { type: 'string', enum: ['desktop', 'server'] }, ops: { type: 'string' }, deps: { type: 'object', additionalProperties: { type: 'boolean' } } } },
  },
  'GET /boot': {
    summary: 'Everything the interface needs for a first paint, in one round trip.',
    tags: ['ops'],
    query: [channelParam],
  },
  'GET /channels': { summary: 'Every channel, with the active one named.', tags: ['channels'], reply: { type: 'object', properties: { channels: array('Channel'), active: { type: 'string' } } } },
  'GET /projects': {
    summary: 'Project summaries for a channel, newest first.',
    tags: ['projects'],
    query: [channelParam, { name: 'category', in: 'query', schema: { type: 'string', enum: ['short', 'landscape'] } }],
    reply: { type: 'object', properties: { projects: array('ProjectSummary') } },
  },
  'POST /projects': {
    summary: 'Create a project. Send clientRef (or an Idempotency-Key header) so a retry cannot create a second one.',
    tags: ['projects'],
    body: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string' },
        channelId: { type: 'string' },
        clientRef: { type: 'string', description: 'Your own reference. Unique per channel; a repeat returns the first project with reused:true.' },
        config: { type: 'object', additionalProperties: true, description: 'Overrides layered over channel defaults and the default preset.' },
      },
    },
    reply: { type: 'object', properties: { project: ref('ProjectSummary'), reused: { type: 'boolean' } } },
    codes: ['channel_not_found', 'channel_denied', 'idempotency_key_reused'],
  },
  'GET /projects/{id}': {
    summary: 'One project. ?scenes=lite drops the generated page from every scene; ?scenes=0 returns the project alone.',
    tags: ['projects'],
    query: [{ name: 'scenes', in: 'query', schema: { type: 'string', enum: ['full', 'lite', '0'] } }],
    codes: ['not_found'],
  },
  'PUT /projects/{id}': { summary: 'Edit title, topic, aspect ratio, config or metadata.', tags: ['projects'], codes: ['not_found'] },
  'DELETE /projects/{id}': { summary: 'Delete a project and its files.', tags: ['projects'], codes: ['not_found'] },
  'POST /projects/{id}/start': { summary: 'Run the pipeline. Returns as soon as the job is queued.', tags: ['pipeline'], codes: ['not_found'] },
  'POST /projects/{id}/stop': { summary: 'Ask a run to stop at its next checkpoint. Durable across a restart.', tags: ['pipeline'] },
  'POST /projects/{id}/resume': { summary: 'Continue a stopped or held run.', tags: ['pipeline'] },
  'POST /projects/{id}/restart': { summary: 'Start again as a NEW project; the previous attempt survives for comparison.', tags: ['pipeline'], codes: ['not_found'] },
  'POST /projects/{id}/render': { summary: 'Re-render clips (mode: all | scenes | concat).', tags: ['pipeline'] },
  'POST /projects/{id}/approve-scenes': {
    summary: 'Pass the scene gate: the only thing that stamps scenes_approved_at and lets TTS spend.',
    tags: ['pipeline'],
    codes: ['not_found', 'gate_not_at_scenes'],
  },
  'GET /projects/{id}/voice-estimate': { summary: 'Characters still to synthesize, the resolved provider and the cost.', tags: ['pipeline'], codes: ['not_found'] },
  'POST /estimate-cost': { summary: 'What a video would cost before creating one.', tags: ['pipeline'] },
  'POST /batch': { summary: 'Many topics at once; the scheduler runs them one at a time.', tags: ['pipeline'], codes: ['input_no_topic'] },
  'GET /jobs': { summary: 'Recent jobs across every project.', tags: ['ops'], reply: { type: 'object', properties: { jobs: array('Job') } } },
  'GET /projects/{id}/jobs': { summary: 'This project’s run history.', tags: ['ops'], reply: { type: 'object', properties: { jobs: array('Job') } } },
  'POST /jobs/{id}/cancel': { summary: 'Cancel a QUEUED job. A running one stops via /projects/{id}/stop.', tags: ['ops'] },
  'GET /events': {
    summary: 'Durable event feed. Without ?after= it returns the current head, so a first call subscribes rather than replaying history.',
    tags: ['ops'],
    query: [
      { name: 'after', in: 'query', schema: { type: 'integer' }, description: 'Last event id you have seen.' },
      { name: 'wait', in: 'query', schema: { type: 'integer', maximum: 25 }, description: 'Seconds to hold the connection open waiting for the next event.' },
      { name: 'project', in: 'query', schema: { type: 'string' } },
      channelParam,
      { name: 'kinds', in: 'query', schema: { type: 'string' }, description: 'Comma-separated: status,done,error,publish…' },
      { name: 'level', in: 'query', schema: { type: 'string', enum: ['info', 'warn', 'error', 'success'] } },
    ],
    reply: { type: 'object', properties: { events: array('Event'), lastId: { type: 'integer' }, hasMore: { type: 'boolean' } } },
  },
  'GET /projects/{id}/journal': { summary: 'The per-run journal a person reads, newest page last.', tags: ['ops'] },
  'GET /tasks': { summary: 'Everything queued, running or recently finished, across projects.', tags: ['ops'] },
  'GET /usage': { summary: 'What each project spent on LLM and TTS.', tags: ['ops'] },
  'GET /projects/{id}/diagnostics': { summary: 'Why a video failed: deps, masked config, QC, jobs, usage and the last error.', tags: ['ops'], codes: ['not_found'] },
  'GET /projects/{id}/qc-scan': { summary: 'Read the finished project back and report what a person would not catch.', tags: ['quality'] },
  'GET /projects/{id}/typeset-scan': { summary: 'Scenes whose text is at risk of overflowing its frame.', tags: ['quality'] },
  'GET /projects/{id}/contact-sheet': { summary: 'A grid of frames from the finished video.', tags: ['quality'] },
  'POST /topics/suggest': { summary: 'Channel-voiced topic proposals, deduped against everything already made or scheduled. Data only — nothing starts.', tags: ['assistant'], query: [channelParam] },
  'GET /topics/history': { summary: 'Past proposals and what became of them.', tags: ['assistant'], query: [channelParam] },
  'POST /topics/{id}/accept': { summary: 'Turn one proposal into a project and start it. This is the only path from a suggestion to a paid run.', tags: ['assistant'], codes: ['suggestion_not_found'] },
  'POST /topics/{id}/schedule': { summary: 'Put a proposal on the calendar. Creates a slot, not a job.', tags: ['assistant'], codes: ['suggestion_not_found'] },
  'GET /calendar': { summary: 'Scheduled slots.', tags: ['assistant'] },
  'POST /calendar/plan': { summary: 'Fill the coming days from pending proposals. Slots only.', tags: ['assistant'], query: [channelParam] },
  'DELETE /calendar/{id}': { summary: 'Cancel a slot; its idea returns to the pool.', tags: ['assistant'] },
  'POST /projects/{id}/publish': { summary: 'Upload the finished video. Defaults to private.', tags: ['publish'], codes: ['not_found', 'video_not_ready', 'publish_not_connected'] },
  'GET /projects/{id}/publishes': { summary: 'Where this video was published, and what happened.', tags: ['publish'] },
  'GET /publish/status': { summary: 'Which platforms are connected.', tags: ['publish'] },
  'GET /file': { summary: 'Download a file the app owns (the final MP4, a thumbnail, an SRT). Paths outside the allowlist are refused.', tags: ['files'], query: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }], codes: ['forbidden', 'not_found'] },
  'GET /ops/status': { summary: 'Is the queue accepting work, and how much is in flight.', tags: ['ops'], reply: ref('OpsStatus') },
  'POST /ops/pause': { summary: 'Stop claiming new work. Running jobs finish.', tags: ['ops'], reply: ref('OpsStatus') },
  'POST /ops/drain': { summary: 'Pause, and report as draining until the last running job settles.', tags: ['ops'], reply: ref('OpsStatus') },
  'POST /ops/resume': { summary: 'Accept work again.', tags: ['ops'], reply: ref('OpsStatus') },
  'GET /openapi.json': { summary: 'This document.', tags: ['ops'] },
};
