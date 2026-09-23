// The operator's switch: what the queue is doing, and how to make it stop.
import { opsState, setOpsState } from '../../ops/state.js';
import { runningCount, scheduleTick } from '../../pipeline/scheduler.js';
import { jobCounts } from '../../db/index.js';
import { notifyWebhooks } from '../../ops/webhooks.js';

const report = () => ({ ops: opsState(), jobs: { ...jobCounts(), runningHere: runningCount() } });

/** @param {import('express').Router} r */
export function mount(r) {
  r.get('/ops/status', (req, res) => res.json(report()));

  // Stop claiming work now. Whatever is rendering keeps rendering — cutting a run in half wastes
  // everything it already paid for; /projects/:id/stop is the way to end one deliberately.
  r.post('/ops/pause', (req, res) => {
    setOpsState('paused', { by: req.actor || null, reason: req.body?.reason || null });
    notifyWebhooks('ops.paused', report());
    res.json(report());
  });

  // The same, but answered honestly: still draining while anything is running, paused once it is not.
  r.post('/ops/drain', (req, res) => {
    setOpsState(runningCount() ? 'draining' : 'paused', { by: req.actor || null, reason: req.body?.reason || null });
    res.json(report());
  });

  r.post('/ops/resume', (req, res) => {
    setOpsState('running', { by: req.actor || null });
    scheduleTick(0); // pick the queue back up at once, not at the next safety-net tick
    notifyWebhooks('ops.resumed', report());
    res.json(report());
  });
}
