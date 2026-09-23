# Playbook: plan a week

**Goal.** A channel has something to publish every day next week, chosen rather than improvised.

1. **Propose.** `POST /api/topics/suggest { channelId, count: 8, niche }`. Proposals are data: they
   are deduped against everything the channel already made, scheduled or dismissed, and nothing is
   started or spent by asking.
2. **Choose.** Read the scores (`viral`, `evergreen`, `difficulty`) and the two title options. Drop
   what does not fit the channel; dismiss it (`POST /api/topics/:id/dismiss`) so it stops coming back.
3. **Schedule.** `POST /api/calendar/plan { channelId, days: 7, perDay: 1, times: ['08:00'] }`, or
   one at a time with `POST /api/topics/:id/schedule { dueAt }`. This creates **slots**, not jobs:
   the scheduler turns each into a project at its time.
4. **Check the load.** A slot becomes a real run, so a week of slots is a week of spending. Compare
   with the channel's daily caps (`GET /api/settings` → `budget`) before you fill every day.
5. **Watch.** `GET /api/calendar` for what is due; `GET /api/events?after=<id>&kinds=status,done,error`
   for what happened. A slot that could not be created returns its idea to the pool and says so in
   the system lane of the journal.

## Do not

- Do not accept proposals straight into runs (`POST /api/topics/:id/accept`) for a whole week: that
  starts every one of them now.
- Do not schedule past a cap and rely on the engine to refuse — it will, but the slot is then wasted.
