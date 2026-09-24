// The durable event feed: everything that happened, after the last thing you saw.
//
// The WebSocket is a live wire — miss the moment and the moment is gone, which is fine for a window
// that is open and wrong for an agent that calls, goes away, and calls back. This reads the journal
// rows the pipeline already writes, forwards from a cursor, so nothing is lost between visits.
import * as DB from '../../db/index.js';
import { channelIdFor } from '../channel-scope.js';
import { sleep } from '../../util/retry.js';

/** How long a caller may hold the connection waiting for something to happen. */
const MAX_WAIT_MS = 25_000;
/** Poll step while waiting. One indexed lookup on an integer primary key — cheaper than a bus. */
const STEP_MS = 400;

const shape = (e) => ({
  id: e.id,
  at: e.ts,
  projectId: e.project_id,
  channelId: e.channel_id || null,
  jobId: e.job_id,
  actor: e.actor,
  level: e.level,
  stage: e.stage,
  sceneIdx: e.scene_idx,
  kind: e.kind,
  msg: e.msg,
  data: e.data,
});

/** @param {import('express').Router} r */
export function mount(r) {
  r.get('/events', async (req, res) => {
    const q = {
      afterId: parseInt(req.query.after, 10) || 0,
      projectId: req.query.project ? String(req.query.project) : null,
      channelId: req.query.channel ? channelIdFor(req) : null,
      kinds: req.query.kinds ? String(req.query.kinds).split(',') : null,
      level: req.query.level ? String(req.query.level) : null,
      limit: req.query.limit,
    };
    // `after` is required to mean it: without a cursor the caller gets the head, never the history,
    // so a first call is a subscription rather than a replay of every run ever made.
    if (!req.query.after) {
      return res.json({ events: [], lastId: DB.journalHeadId(), hasMore: false });
    }
    const wait = Math.min(Math.max(parseInt(req.query.wait, 10) || 0, 0), MAX_WAIT_MS / 1000) * 1000;
    const deadline = Date.now() + wait;
    for (;;) {
      const { events, hasMore } = DB.journalAfter(q);
      if (events.length || Date.now() >= deadline) {
        const lastId = events.length ? events[events.length - 1].id : q.afterId;
        return res.json({ events: events.map(shape), lastId, hasMore });
      }
      await sleep(STEP_MS);
      if (res.writableEnded) return undefined; // the caller gave up first
    }
  });
}
