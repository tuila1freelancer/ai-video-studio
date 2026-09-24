// The tools an agent sees, named after intentions rather than routes.
//
// An agent reading "POST /projects then POST /projects/:id/start then poll GET /projects/:id" has to
// invent the workflow every time; "make a video and wait for it" is the workflow. Each tool is one
// to three SDK calls and a shape worth reading back — nothing here decides anything the engine has
// not already decided, which is why the kit can be public and the engine closed.
import { writeFileSync } from 'node:fs';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const num = (description) => ({ type: 'number', description });
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const CHANNEL = str('Channel id. Leave empty for the token’s own channel, or the active one.');

/** Making a video, and everything that happens to one. */
function videoTools(avs) {
  return [
    {
      name: 'avs_health',
      description: 'Is the engine up, which external tools it found, and whether the queue is accepting work.',
      inputSchema: schema({}),
      run: () => avs.health(),
    },
    {
      name: 'avs_channels_list',
      description: 'The channels this installation produces for. Every other tool takes a channelId from here.',
      inputSchema: schema({}),
      run: () => avs.channels(),
    },
    {
      name: 'avs_projects_list',
      description: 'Videos in a channel, newest first, with their status.',
      inputSchema: schema({ channelId: CHANNEL, category: str('short | landscape') }),
      run: ({ channelId, category }) => avs.projects({ channel: channelId, category }),
    },
    {
      name: 'avs_video_create',
      description: 'Create a video from a topic and (optionally) run it. ALWAYS pass clientRef — a retry with the same reference returns the first video instead of making a second one. dryRun prices it without creating anything.',
      inputSchema: schema({
        topic: str('What the video is about. A sentence or a whole pasted script.'),
        channelId: CHANNEL,
        clientRef: str('Your own reference for this request; unique per channel.'),
        config: { type: 'object', description: 'Overrides layered over the channel defaults (videoDuration, aspectRatio, sceneGate, autoPublish…).', additionalProperties: true },
        start: bool('Run it now. Default true.'),
        wait: bool('Hold until the run reaches done | error | paused | scenes | review.'),
        waitSeconds: num('How long to hold when wait is true. Default 1800.'),
        dryRun: bool('Price it and return, creating nothing.'),
      }, ['topic']),
      async run({ topic, channelId, clientRef, config, start = true, wait = false, waitSeconds = 1800, dryRun = false }) {
        if (dryRun) return { dryRun: true, ...(await avs.estimateCost({ ...(config || {}), config })) };
        const { project, reused } = await avs.createProject({ topic, channelId, clientRef, config });
        if (reused) return { project, reused: true, note: 'A video already existed under this clientRef; nothing was created.' };
        if (!start) return { project, started: false };
        await avs.startProject(project.id);
        if (!wait) return { project, started: true };
        const settled = await avs.waitFor(project.id, { timeoutMs: waitSeconds * 1000 });
        return { project: settled, started: true, waited: true };
      },
    },
    {
      name: 'avs_video_status',
      description: 'Where one video is: status, current step, the last error, and its recent jobs.',
      inputSchema: schema({ projectId: str('Project id') }, ['projectId']),
      async run({ projectId }) {
        const [{ project }, jobs] = await Promise.all([avs.project(projectId), avs.jobs(projectId)]);
        return { project, jobs: jobs.jobs?.slice(0, 5) || [] };
      },
    },
    {
      name: 'avs_video_verdict',
      description: 'May this video be published? Returns publishable plus the reasons that decided it. Read this BEFORE publishing; branch on reasons[].code, never on the words.',
      inputSchema: schema({ projectId: str('Project id'), vision: bool('Also ask a multimodal model to look at the frames (costs a call; only works if the channel enabled it).') }, ['projectId']),
      run: ({ projectId, vision = false }) => avs.verdict(projectId, { vision }),
    },
    {
      name: 'avs_video_approve_scenes',
      description: 'Pass the scene gate for a video held at status "scenes". This is what lets the voice be paid for, so only do it when the storyboard is what the channel wants.',
      inputSchema: schema({ projectId: str('Project id') }, ['projectId']),
      run: ({ projectId }) => avs.approveScenes(projectId),
    },
    {
      name: 'avs_video_publish',
      description: 'Upload a finished video. Defaults to private. The channel policy may clamp the privacy, require the verdict to pass, cap the day, or refuse outside its hours.',
      inputSchema: schema({
        projectId: str('Project id'),
        privacy: str('private | unlisted | public. Default private.'),
        platform: str('youtube | facebook. Default youtube.'),
        force: bool('Publish even if the verdict refused. Recorded in the journal.'),
      }, ['projectId']),
      run: ({ projectId, privacy = 'private', platform = 'youtube', force = false }) => avs.publish(projectId, { privacy, platform, force }),
    },
    {
      name: 'avs_video_stop',
      description: 'Ask a run to stop at its next checkpoint. Survives a restart.',
      inputSchema: schema({ projectId: str('Project id') }, ['projectId']),
      run: ({ projectId }) => avs.stopProject(projectId),
    },
    {
      name: 'avs_video_resume',
      description: 'Continue a stopped or held run from where it left off.',
      inputSchema: schema({ projectId: str('Project id') }, ['projectId']),
      run: ({ projectId }) => avs.resumeProject(projectId),
    },
  ];
}

/** Planning, watching and stopping — what an operator does rather than what a maker does. */
function opsTools(avs) {
  return [
    {
      name: 'avs_topics_suggest',
      description: 'Topic proposals in the channel’s own voice, deduped against everything it already made, scheduled or dismissed. Data only — nothing starts and nothing is spent.',
      inputSchema: schema({ channelId: CHANNEL, niche: str('Narrow the proposals.'), count: num('How many. Up to 12.') }),
      run: ({ channelId, niche, count }) => avs.suggestTopics({ channelId, niche, count }),
    },
    {
      name: 'avs_calendar_plan',
      description: 'Fill the coming days from pending proposals. Creates calendar slots, which the scheduler turns into videos at their time — it does not start anything now.',
      inputSchema: schema({
        channelId: CHANNEL, days: num('How many days. Default 7.'), perDay: num('Videos per day. Default 1.'),
        times: { type: 'array', items: { type: 'string' }, description: 'Local times, e.g. ["08:00","18:00"].' },
      }),
      run: ({ channelId, days, perDay, times }) => avs.planWeek({ channelId, days, perDay, times }),
    },
    {
      name: 'avs_calendar_list',
      description: 'What is scheduled, and what became of it.',
      inputSchema: schema({}),
      run: () => avs.calendar(),
    },
    {
      name: 'avs_journal_tail',
      description: 'Everything that happened after an event id. Call once with no cursor to get the current head, then pass lastId back each time — nothing is missed between calls.',
      inputSchema: schema({
        after: num('Last event id you saw. Omit to get the head without any history.'),
        projectId: str('Only this video.'), channelId: CHANNEL,
        level: str('info | warn | error | success'), kinds: str('Comma-separated kinds, e.g. status,done,error'),
        waitSeconds: num('Hold open up to this long waiting for the next event. Max 25.'),
      }),
      run: ({ after, projectId, channelId, level, kinds, waitSeconds }) =>
        avs.events({ after, project: projectId, channel: channelId, level, kinds, wait: waitSeconds }),
    },
    {
      name: 'avs_usage',
      description: 'What has been spent, per video. Check this before starting a batch.',
      inputSchema: schema({}),
      run: () => avs.usage(),
    },
    {
      name: 'avs_ops',
      description: 'The queue’s stop valve. pause stops new work (running jobs finish), drain reports until the last one settles, resume opens it again.',
      inputSchema: schema({ action: str('status | pause | drain | resume'), reason: str('Why, for the record.') }, ['action']),
      run: ({ action, reason }) => {
        if (action === 'pause') return avs.pause(reason);
        if (action === 'drain') return avs.drain(reason);
        if (action === 'resume') return avs.resume();
        return avs.ops();
      },
    },
    {
      name: 'avs_file_get',
      description: 'Download a file the engine owns — the finished MP4, a thumbnail, an SRT — to a local path.',
      inputSchema: schema({ path: str('Absolute path as it appears in the project row (video_path, thumb_path).'), saveTo: str('Where to write it locally.') }, ['path', 'saveTo']),
      async run({ path, saveTo }) {
        const bytes = await avs.fileBytes(path);
        writeFileSync(saveTo, bytes);
        return { saved: saveTo, bytes: bytes.length };
      },
    },
  ];
}

/**
 * @param {import('./sdk.js').AvsClient} avs
 * @returns {Array<{name:string, description:string, inputSchema:object, run:(args:object)=>Promise<any>}>}
 */
export function tools(avs) {
  return [...videoTools(avs), ...opsTools(avs)];
}
