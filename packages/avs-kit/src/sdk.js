// The one client every part of the kit talks through.
//
// Deliberately dependency-free: Node 22 has fetch, and a kit an agent installs should not drag a
// tree of packages onto someone's machine. Deliberately thin, too — it carries the token, the
// channel and the idempotency key, and it turns a refusal into an AvsError with the engine's code.
// It holds no opinions about how a video should be made; those live in the engine.
import { AvsError } from './errors.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class AvsClient {
  /**
   * @param {{url?:string, token?:string, channel?:string, timeoutMs?:number, fetchImpl?:typeof fetch}} opts
   */
  constructor({ url, token, channel, timeoutMs = 120_000, fetchImpl } = {}) {
    this.base = String(url || process.env.AVS_URL || 'http://127.0.0.1:8123').replace(/\/+$/, '');
    this.token = token || process.env.AVS_TOKEN || '';
    this.channel = channel || process.env.AVS_CHANNEL || '';
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  /** Every call goes through here, so the token, the channel and the error shape are in one place. */
  async request(method, path, opts) {
    const { data } = await this.requestRaw(method, path, opts);
    return data;
  }

  /** The same, with the response itself — a few callers need a header the body does not carry. */
  async requestRaw(method, path, { body, query, idempotencyKey, timeoutMs } = {}) {
    const url = new URL(`${this.base}/api${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers: {
          ...(body === undefined ? {} : JSON_HEADERS),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(this.channel ? { 'X-AVS-Channel': this.channel } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs || this.timeoutMs),
      });
    } catch (e) {
      // No reply at all: unreachable, refused, timed out. Temporary by nature — status 0 says so.
      throw new AvsError(`${method} ${path}: ${e.message}`, { code: 'unreachable', status: 0 });
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { /* not JSON — the message below carries it */ } }
    if (!res.ok) {
      throw new AvsError(data?.message || data?.error || `HTTP ${res.status}`, {
        code: data?.code || 'request_failed', status: res.status, body: data,
      });
    }
    return { data, res };
  }

  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body, opts) { return this.request('POST', path, { body, ...opts }); }

  // ---- what an agent actually does ----------------------------------------
  health() { return this.get('/health'); }
  openapi() { return this.get('/openapi.json'); }
  channels() { return this.get('/channels'); }
  projects(query) { return this.get('/projects', query); }
  project(id, { scenes = '0' } = {}) { return this.get(`/projects/${id}`, { scenes }); }
  jobs(projectId) { return this.get(projectId ? `/projects/${projectId}/jobs` : '/jobs'); }
  usage() { return this.get('/usage'); }
  verdict(id, { vision = false } = {}) { return this.get(`/projects/${id}/verdict`, { vision: vision ? '1' : '0' }); }
  estimateCost(body) { return this.post('/estimate-cost', body); }
  journal(id, query) { return this.get(`/projects/${id}/journal`, query); }

  /**
   * Create a video. With a clientRef this is safe to send twice: the engine either replays the
   * first reply (idempotency key) or finds the project by its reference — `reused` says which,
   * because to a caller both mean the same thing: nothing new was created.
   */
  async createProject({ topic, config, channelId, clientRef } = {}) {
    const { data, res } = await this.requestRaw('POST', '/projects', {
      body: { topic, config, channelId, clientRef }, idempotencyKey: clientRef,
    });
    return { ...data, reused: data?.reused === true || res.headers.get('idempotent-replay') === 'true' };
  }
  startProject(id, body = {}) { return this.post(`/projects/${id}/start`, body); }
  stopProject(id) { return this.post(`/projects/${id}/stop`, {}); }
  resumeProject(id) { return this.post(`/projects/${id}/resume`, {}); }
  approveScenes(id) { return this.post(`/projects/${id}/approve-scenes`, {}); }
  publish(id, body = {}) { return this.post(`/projects/${id}/publish`, body); }
  batch(body) { return this.post('/batch', body); }

  suggestTopics(body) { return this.post('/topics/suggest', body); }
  acceptTopic(id, body = {}) { return this.post(`/topics/${id}/accept`, body); }
  scheduleTopic(id, body) { return this.post(`/topics/${id}/schedule`, body); }
  calendar() { return this.get('/calendar'); }
  planWeek(body) { return this.post('/calendar/plan', body); }
  cancelSlot(id) { return this.request('DELETE', `/calendar/${id}`); }

  ops() { return this.get('/ops/status'); }
  pause(reason) { return this.post('/ops/pause', { reason }); }
  drain(reason) { return this.post('/ops/drain', { reason }); }
  resume() { return this.post('/ops/resume', {}); }

  /** The durable feed. `wait` holds the connection open until something happens. */
  events({ after, wait = 0, project, channel, kinds, level, limit } = {}) {
    return this.get('/events', { after, wait, project, channel, kinds, level, limit });
  }

  /** Download a file the engine owns (the final MP4, a thumbnail, an SRT). */
  async fileBytes(path) {
    const url = new URL(`${this.base}/api/file`);
    url.searchParams.set('path', path);
    const res = await this.fetch(url, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
    if (!res.ok) throw new AvsError(`file ${path}: HTTP ${res.status}`, { code: 'not_found', status: res.status });
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Follow a project until it reaches one of `states` (or the timeout).
   *
   * Polls the project row rather than the event feed: a status is a fact, while events are a
   * narration of one. `onEvent` gets the journal lines in between, for a caller that wants to show
   * progress — which is why the cursor is threaded through rather than restarted each round.
   *
   * @param {string} id
   * @param {{states?:string[], timeoutMs?:number, onEvent?:(e:object)=>void, pollMs?:number}} opts
   */
  async waitFor(id, { states = ['done', 'error', 'paused', 'scenes', 'review'], timeoutMs = 3_600_000, onEvent, pollMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let cursor = onEvent ? (await this.events({})).lastId : 0;
    for (;;) {
      const { project } = await this.project(id);
      if (states.includes(project.status)) return project;
      if (Date.now() > deadline) throw new AvsError(`timed out waiting for ${states.join('|')}`, { code: 'wait_timeout', status: 0 });
      if (onEvent) {
        const feed = await this.events({ after: cursor, project: id, wait: Math.min(20, Math.round(pollMs / 1000) || 3) });
        cursor = feed.lastId || cursor;
        for (const e of feed.events) onEvent(e);
      } else {
        await new Promise((r) => { setTimeout(r, pollMs).unref?.(); });
      }
    }
  }
}

export { AvsError } from './errors.js';
