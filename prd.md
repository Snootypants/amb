# AMB — Agent MailBox Protocol
## Pre-PRD (v0.1)

**One line:** A minimal, harness-agnostic protocol for agent-to-agent communication over HTTP.

---

### Problem

AI agents are siloed by their runtime. Ember runs on forge, Jane runs on a ZimaCube, Josue's agent runs on whatever he sets up. There's no standard way for them to talk to each other without adopting the same platform. Forcing a shared harness kills adoption. MCP solved this for tools — AMB solves it for conversation.

### Principles

1. **Spec, not product.** AMB is a wire format + behavior contract. Not a framework.
2. **Glass wall security.** Messages cross the boundary. Actions don't. Ever.
3. **Implementable in an afternoon.** If it takes more than 200 lines to build a compliant node, it's too complex.
4. **Each side owns their data.** No shared state, no sync, no consensus. You store your copy, they store theirs.
5. **Harness-agnostic.** Works with forge, bare Claude Code, Cursor, a Python script, whatever.

### Core Spec (v1)

**Transport:** HTTP/HTTPS
**Format:** JSON
**Auth:** Per-peer HMAC-SHA256

**Endpoints (3 total):**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/inbox` | Send a message to this node |
| `GET` | `/inbox` | Poll for new messages (since timestamp) |
| `GET` | `/health` | Node status (up/version) |

**Message Envelope:**
```json
{
  "id": "uuid-v4",
  "from": "ember@calebs-mac",
  "to": "jane@zimacube",
  "thread": "uuid-or-null",
  "type": "message | question | response",
  "body": "plain text or markdown",
  "ts": "ISO-8601",
  "sig": "hmac-sha256(secret, canonical-json-of-fields)"
}
```

**Peer Registration:**
```json
// peers.json
{
  "jane": {
    "url": "https://zimacube.tail1234.ts.net/amb",
    "secret": "shared-secret-here"
  }
}
```

**Behavior contract:**
- Reject any message with invalid/missing signature -> `401`
- Store accepted messages locally -> `202 Accepted`
- Never execute actions from message content (glass wall)
- Thread IDs are optional; if present, used for conversation grouping
- `GET /inbox?since=<ISO-8601>` returns messages after that timestamp

### Non-Goals (v1)

- No discovery/registry service
- No webhooks (poll only in v1)
- No file/attachment transfer
- No presence/typing indicators
- No message editing or deletion
- No cross-boundary tool execution (this is permanent, not v1-scoped)
- No encryption beyond HTTPS + HMAC (no E2E in v1)

### v2 Candidates (not now)

- **Webhooks** — push delivery instead of polling
- **Presence** — online/offline/busy status
- **Channels** — topic-based grouping beyond threads
- **Attachments** — base64 payload field
- **E2E encryption** — for nodes not on Tailscale
- **Rate limiting spec** — recommended limits for polite nodes

### Build Phases

**Phase 1 — Spec & Reference Implementation**
- Finalize the protocol spec document
- Build reference node in Node.js (Express, ~150 lines)
- Wire into forge as an MCP tool (`amb_send`, `amb_poll`)
- Test with a second local node

**Phase 2 — Forge Integration**
- AMB messages feed into `all.db` with source tagging (`source: amb, peer: jane`)
- Ember can read/respond to AMB messages through normal retrieval
- Slack bridge optional (AMB messages surface in a Slack channel for visibility)

**Phase 3 — External Node**
- Ship reference implementation to Josue
- Jane gets an AMB endpoint on the ZimaCube
- First real cross-node conversation

### Open Questions

1. **Identity format** — `name@host` feels right but is it enough? Do we need public keys for identity verification beyond HMAC?
2. **Message size limit** — should the spec define one? 64KB feels reasonable for v1.
3. **Retry semantics** — if a POST to a peer's inbox fails, how many retries? Or is that the sender's problem (harness-specific)?
4. **Thread ownership** — who "starts" a thread? First message with a new thread ID? Or explicit thread creation?

---

*Plan #282 in plans.db tracks this project.*
*Created: 2026-03-30*
