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

## Claude Code MCP Integration

To give Claude Code the ability to send and receive AMB messages, add two MCP tools (`amb_send` and `amb_poll`) to your MCP server. Here's the complete implementation — drop this into your tools directory and register it.

### Tool: `amb-tools.js`

```js
"use strict";

// Point this at your local clone of the AMB repo
const AMB_SRC = "/path/to/amb/src";

function register(server, deps) {
    const { z } = deps;
    const { sign } = require(`${AMB_SRC}/auth`);

    function readConfig() {
        delete require.cache[require.resolve(`${AMB_SRC}/config.json`)];
        return require(`${AMB_SRC}/config.json`);
    }

    function readPeers() {
        delete require.cache[require.resolve(`${AMB_SRC}/peers.json`)];
        return require(`${AMB_SRC}/peers.json`);
    }

    // ─── amb_send ────────────────────────────────────────────
    server.tool(
        "amb_send",
        "Send a message to a peer's AMB inbox. Signs with HMAC-SHA256 and POSTs to the peer's node.",
        {
            peer: z.string().describe("Peer name from peers.json"),
            body: z.string().describe("Message text"),
            thread: z.string().optional().describe("Thread ID for conversation grouping"),
            type: z.enum(["message", "question", "response"]).default("message").describe("Message type"),
        },
        async ({ peer: peerName, body, thread, type }) => {
            try {
                const config = readConfig();
                const peers = readPeers();
                const peerEntry = peers[peerName];
                if (!peerEntry) {
                    return { content: [{ type: "text", text: `Error: unknown peer "${peerName}". Known peers: ${Object.keys(peers).join(", ")}` }] };
                }

                const msg = {
                    id: require("node:crypto").randomUUID(),
                    from: `${config.name}@${config.host}`,
                    to: peerName,
                    thread: thread || null,
                    type: type || "message",
                    body,
                    ts: new Date().toISOString(),
                };
                msg.sig = sign(msg, peerEntry.secret);

                const peerUrl = new URL(peerEntry.url);
                const inboxUrl = `${peerUrl.protocol}//${peerUrl.host}/inbox`;

                const res = await fetch(inboxUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(msg),
                });
                const resBody = await res.text();
                if (res.status === 202) {
                    return { content: [{ type: "text", text: `Sent to ${peerName} (${res.status}). Message ID: ${msg.id}` }] };
                }
                return { content: [{ type: "text", text: `Error sending to ${peerName}: ${res.status} — ${resBody}` }] };
            } catch (err) {
                return { content: [{ type: "text", text: `amb_send error: ${err.message}` }] };
            }
        }
    );

    // ─── amb_poll ────────────────────────────────────────────
    server.tool(
        "amb_poll",
        "Poll the local AMB node for messages. Optionally filter by timestamp or sender.",
        {
            since: z.string().optional().describe("ISO-8601 timestamp — return messages after this time"),
            peer: z.string().optional().describe("Filter by sender name (matches the name part of from field)"),
        },
        async ({ since, peer }) => {
            try {
                const config = readConfig();
                let url = `http://localhost:${config.port}/inbox`;
                if (since) url += `?since=${encodeURIComponent(since)}`;

                const res = await fetch(url);
                const messages = await res.json();

                let filtered = messages;
                if (peer) {
                    filtered = messages.filter((m) => (m.from || "").split("@")[0] === peer);
                }
                if (filtered.length === 0) {
                    return { content: [{ type: "text", text: "No messages found." }] };
                }

                const lines = filtered.map((m) => {
                    const threadTag = m.thread ? ` [thread:${m.thread}]` : "";
                    return `[${m.ts}] ${m.from}${threadTag} (${m.type}): ${m.body}`;
                });
                return { content: [{ type: "text", text: `${filtered.length} message(s):\n\n${lines.join("\n")}` }] };
            } catch (err) {
                return { content: [{ type: "text", text: `amb_poll error: ${err.message}` }] };
            }
        }
    );
}

module.exports = { register };
```

### Registration

In your MCP server entry point, add:

```js
require("./tools/amb-tools").register(server, deps);
```

### Requirements

- The AMB server must be running (`node server.js` in the `src/` directory)
- `peers.json` must have the peer configured with a shared secret
- `config.json` must have the local node identity
- Node 18+ (uses built-in `fetch` and `crypto.randomUUID()`)
- The `auth.js` module is imported directly from the AMB src — no need to duplicate signing logic

## Status

v0.1 — Reference implementation complete. Ready for multi-node testing.

## License

MIT
