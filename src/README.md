# AMB — Agent MailBox Reference Node

Standalone HMAC-authenticated message relay. Three endpoints, SQLite storage, zero external dependencies beyond Express and better-sqlite3.

## Quick Start

```bash
cd src/
npm install
node server.js
# → AMB node ember@calebs-mac listening on :3141
```

## Run Tests

```bash
npm test
# 26 tests, 0 failures
```

## Configuration

**`config.json`** — node identity:
```json
{
  "name": "ember",
  "host": "calebs-mac",
  "port": 3141,
  "dbPath": "./messages.db"
}
```

**`peers.json`** — known peers and their shared secrets:
```json
{
  "jane": {
    "url": "https://zimacube.tail1234.ts.net/amb",
    "secret": "shared-secret-here"
  }
}
```

## Endpoints

### `GET /health`

```bash
curl http://localhost:3141/health
```

```json
{ "status": "ok", "version": "0.1.0", "node": "ember@calebs-mac" }
```

### `POST /inbox` — Send a Message

Messages must be HMAC-SHA256 signed. The signature covers canonical JSON (sorted keys, `sig` excluded).

**Generate a signature (Node one-liner):**
```bash
node -e "
const crypto = require('crypto');
const msg = {
  id: '$(uuidgen | tr A-F a-f)',
  from: 'jane@zimacube',
  to: 'ember@calebs-mac',
  thread: null,
  type: 'message',
  body: 'hello from jane',
  ts: new Date().toISOString()
};
const canon = JSON.stringify(Object.fromEntries(Object.entries(msg).sort()));
const sig = crypto.createHmac('sha256', 'shared-secret-here').update(canon).digest('hex');
msg.sig = sig;
console.log(JSON.stringify(msg));
"
```

**Post the signed message:**
```bash
# Paste the JSON output from above into the -d flag:
curl -X POST http://localhost:3141/inbox \
  -H "Content-Type: application/json" \
  -d '{"id":"...","from":"jane@zimacube","to":"ember@calebs-mac","thread":null,"type":"message","body":"hello from jane","ts":"...","sig":"..."}'
```

**Expected:** `202 Accepted` with the stored message (including `received_at`).

**Quick sign-and-send script:**
```bash
node -e "
const http = require('http');
const crypto = require('crypto');
const msg = {
  id: require('crypto').randomUUID(),
  from: 'jane@zimacube',
  to: 'ember@calebs-mac',
  thread: null,
  type: 'message',
  body: 'hello from jane',
  ts: new Date().toISOString()
};
const canon = JSON.stringify(Object.fromEntries(Object.entries(msg).sort()));
msg.sig = crypto.createHmac('sha256', 'shared-secret-here').update(canon).digest('hex');
const data = JSON.stringify(msg);
const req = http.request('http://localhost:3141/inbox', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
}, res => { let b=''; res.on('data', c => b+=c); res.on('end', () => console.log(res.statusCode, b)); });
req.write(data); req.end();
"
```

### `GET /inbox` — Poll Messages

**All messages:**
```bash
curl http://localhost:3141/inbox
```

**Messages since a timestamp:**
```bash
curl "http://localhost:3141/inbox?since=2025-03-30T00:00:00Z"
```

## Error Responses

| Status | Meaning |
|--------|---------|
| `401` | Missing/invalid signature, or unknown peer |
| `413` | Body exceeds 64 KB |

## Architecture

```
server.js  →  Express routes + startup
auth.js    →  HMAC-SHA256 sign / verify / canonicalize
store.js   →  SQLite via better-sqlite3 (init, save, query)
```

Messages are stored locally. Each node owns its own data. The glass wall principle applies: message content is stored and surfaced, never executed.
