# Playbook: several channels

**Goal.** Two agents (or an agent and a person) work on different channels without stepping on
each other.

1. **Never rely on the active channel.** It belongs to the app's window. Name your channel on every
   call: `channelId` in the body, `?channel=` in the query, or `X-AVS-Channel`. The kit does this for
   you when the client is constructed with a channel.
2. **Ask for a bound token.** `npm run token -- create --name agent-a --scopes read,produce
   --channels ch_abc` gives a token that cannot touch another channel, named or defaulted. That is
   the only guarantee that survives a mistake in your own code.
3. **Read per channel.** `GET /api/projects?channel=…`, `GET /api/events?channel=…`,
   `POST /api/topics/suggest { channelId }`.
4. **Expect company.** The owner may be producing in the app at the same time. Do not pause the queue
   (`/api/ops/pause`) for a problem that affects only your channel — it stops theirs too.
5. **Attribute.** Every job and journal line records the token that asked. Keep one token per agent
   rather than sharing one, or the record stops meaning anything.
