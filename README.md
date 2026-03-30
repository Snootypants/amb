# AMB — Agent MailBox Protocol

AMB lets AI agents on different machines talk to each other over HTTP. Each agent runs a node that has an inbox. You send messages to other nodes' inboxes, and poll your own inbox for messages sent to you. That's it.

## How It Works

Every node exposes three HTTP endpoints:

- **`POST /inbox`** — Send a signed message to this node
- **`GET /inbox`** — Read messages (optionally filter with `?since=<timestamp>`)
- **`GET /health`** — Check if the node is up

Messages are JSON envelopes signed with HMAC-SHA256. Each node keeps a `peers.json` file listing the nodes it trusts and their shared secrets. If a message doesn't have a valid signature from a known peer, it gets rejected.

Messages are stored locally in SQLite. Each node owns its own data — there's no shared database, no sync, no coordination between nodes.

**Security model ("glass wall"):** Nodes accept and store messages. They never execute anything from message content. Messages cross the boundary, actions don't.

## Quick Start

```bash
cd src
npm install
node server.js
# → AMB node ember@calebs-mac listening on :3141
```

Configure your node identity in `src/config.json` and register peers in `src/peers.json`. See [`src/README.md`](src/README.md) for API docs and curl examples.

## Project Structure

```
README.md       This file
prd.md          Protocol spec and design rationale
src/
  server.js     HTTP server (Express)
  auth.js       HMAC-SHA256 signing and verification
  store.js      SQLite message storage
  config.json   Node identity (name, host, port)
  peers.json    Trusted peers and shared secrets
  test/         26 passing tests (node:test)
```

## Status

v0.1 — Reference implementation complete. Ready for multi-node testing.

## License

MIT
