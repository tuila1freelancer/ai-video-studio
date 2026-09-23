// The shapes an agent reads and writes. Hand-written because they are a CONTRACT: generating them
// from whatever a handler happened to return would document today's accident as tomorrow's promise.
export const SCHEMAS = {
  Error: {
    type: 'object',
    required: ['code', 'error'],
    properties: {
      code: { type: 'string', description: 'Stable machine word. Branch on this, never on `error`.' },
      error: { type: 'string', description: "Short reason, in the owner's language unless ?lang= says otherwise." },
      message: { type: 'string' },
      hint: { type: 'string' },
    },
  },
  Channel: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      root_dir: { type: 'string' },
      config: { type: 'object', additionalProperties: true },
    },
  },
  ProjectSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      topic: { type: 'string', description: 'First 200 characters only in list replies.' },
      status: { type: 'string', enum: ['draft', 'running', 'paused', 'scenes', 'review', 'done', 'error'] },
      current_step: { type: 'string', nullable: true, description: 'b2|b34|b5|b6|b7' },
      aspect_ratio: { type: 'string' },
      channel_id: { type: 'string' },
      video_path: { type: 'string', nullable: true },
      thumb_path: { type: 'string', nullable: true },
      error: { type: 'string', nullable: true },
      scenes_approved_at: { type: 'integer', nullable: true },
      created_at: { type: 'integer' },
      updated_at: { type: 'integer' },
    },
  },
  Job: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      kind: { type: 'string', enum: ['pipeline', 'render'] },
      project_id: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'running', 'done', 'error', 'cancelled'] },
      attempts: { type: 'integer' },
      actor: { type: 'string', nullable: true, description: 'token:<id> | ui | scheduler' },
      error: { type: 'string', nullable: true },
    },
  },
  Event: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'Cursor. Pass the last one you saw as ?after=.' },
      at: { type: 'integer' },
      projectId: { type: 'string', nullable: true },
      channelId: { type: 'string', nullable: true },
      jobId: { type: 'string', nullable: true },
      actor: { type: 'string', nullable: true },
      level: { type: 'string', enum: ['info', 'warn', 'error', 'success'] },
      stage: { type: 'string', nullable: true },
      kind: { type: 'string', description: 'op|step|retry|log|status|done|error|usage|publish|enqueue|sys' },
      msg: { type: 'string' },
      data: { type: 'object', nullable: true, additionalProperties: true },
    },
  },
  OpsStatus: {
    type: 'object',
    properties: {
      ops: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: ['running', 'paused', 'draining'] },
          at: { type: 'integer', nullable: true },
          by: { type: 'string', nullable: true },
          reason: { type: 'string', nullable: true },
        },
      },
      jobs: {
        type: 'object',
        properties: {
          queued: { type: 'integer' },
          running: { type: 'integer' },
          runningHere: { type: 'integer' },
        },
      },
    },
  },
};
