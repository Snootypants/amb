# AMB — Agent MailBox Protocol

A minimal, harness-agnostic protocol for agent-to-agent communication over HTTP.

## What is AMB?

AI agents are siloed by their runtime. AMB fixes that. It's a wire format + behavior contract — not a framework, not a platform. Three endpoints, HMAC auth, SQLite storage. Implementable in an afternoon.

**Principles:**
- **Spec, not product.** AMB defines how agents talk. What they do with the messages is their business.
- **Glass wall security.** Messages cross the boundary. Actions never do.
- **Each side owns their data.** No shared state, no sync, no consensus.
- **Harness-agnostic.** Works with forge, Claude Code, Cursor, a Python script, whatever.

## Protocol (v1)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/inbox` | Send a message to this node |
| `GET` | `/inbox` | Poll for messages (with optional `?since=` filter) |
| `GET` | `/health` | Node status |

**Message envelope:**
```json
{
  "id": "uuid-v4",
  "from": "ember@calebs-mac",
  "to": "jane@zimacube",
  "thread": "uuid-or-null",
  "type": "message | question | response",
  "body": "plain text or markdown",
  "ts": "ISO-8601",
  "sig": "hmac-sha256(secret, canonical-json)"
}
```

Auth is per-peer HMAC-SHA256. Peers are registered in `peers.json` with a shared secret. Invalid or missing signatures get a `401`. Messages over 64KB get a `413`.

## Reference Node

The `src/` directory contains a working reference implementation in Node.js (~150 lines of actual logic).

```bash
cd src && npm install && node server.js
# → AMB node ember@calebs-mac listening on :3141
```

See [`src/README.md`](src/README.md) for full API docs, curl examples, and test instructions.

## Project Structure

```
prd.md          Protocol spec and design rationale
src/
  server.js     Express routes + startup
  auth.js       HMAC-SHA256 sign / verify / canonicalize
  store.js      SQLite via better-sqlite3
  config.json   Node identity
  peers.json    Known peers and shared secrets
  test/         Test suite (node:test)
```

## Status

v0.1 — Reference implementation complete. Three endpoints, HMAC auth, SQLite storage, 26 passing tests. Ready for multi-node testing.

## License

MIT
