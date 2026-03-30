const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sign } = require('../auth');

let baseURL;
let server;

/**
 * Helper: make an HTTP request and return { status, headers, body }.
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseURL);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {},
    };
    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Build a valid message envelope, properly signed. */
function validMessage(overrides = {}) {
  const msg = {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    from: 'jane@zimacube',
    to: 'ember@calebs-mac',
    thread: null,
    type: 'message',
    body: 'hello from jane',
    ts: new Date().toISOString(),
    ...overrides,
  };
  // "jane" has secret "test-secret" in the test peers config
  const peerName = msg.from.split('@')[0];
  msg.sig = sign(msg, 'test-secret');
  return msg;
}

describe('server integration', () => {
  before(async () => {
    // createApp is exported so tests can spin up the server on a random port
    const { createApp } = require('../server');
    const app = createApp({
      config: { name: 'ember', host: 'calebs-mac', port: 0, dbPath: ':memory:' },
      peers: {
        jane: { url: 'http://localhost', secret: 'test-secret' },
      },
    });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseURL = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // ─── GET /health ───────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with status object', async () => {
      const res = await request('GET', '/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.equal(res.body.version, '0.1.0');
      assert.equal(res.body.node, 'ember@calebs-mac');
    });
  });

  // ─── POST /inbox ──────────────────────────────────────────
  describe('POST /inbox', () => {
    it('accepts a valid signed message → 202', async () => {
      const msg = validMessage();
      const res = await request('POST', '/inbox', msg);
      assert.equal(res.status, 202);
      assert.ok(res.body.received_at);
    });

    it('rejects bad signature → 401', async () => {
      const msg = validMessage();
      msg.sig = 'deadbeef'.repeat(8); // 64 hex chars, but wrong
      const res = await request('POST', '/inbox', msg);
      assert.equal(res.status, 401);
    });

    it('rejects missing signature → 401', async () => {
      const msg = validMessage();
      delete msg.sig;
      const res = await request('POST', '/inbox', msg);
      assert.equal(res.status, 401);
    });

    it('rejects unknown peer → 401', async () => {
      const msg = validMessage({ from: 'unknown@nowhere' });
      msg.sig = sign(msg, 'whatever');
      const res = await request('POST', '/inbox', msg);
      assert.equal(res.status, 401);
    });

    it('rejects oversized body → 413', async () => {
      const msg = validMessage({ body: 'x'.repeat(65 * 1024) });
      msg.sig = sign(msg, 'test-secret');
      const res = await request('POST', '/inbox', msg);
      assert.equal(res.status, 413);
    });
  });

  // ─── GET /inbox ───────────────────────────────────────────
  describe('GET /inbox', () => {
    it('returns all stored messages', async () => {
      // Post a message first so there's at least one
      const msg = validMessage();
      await request('POST', '/inbox', msg);

      const res = await request('GET', '/inbox');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 1);
    });

    it('filters messages by since parameter', async () => {
      const old = validMessage({
        id: 'old-msg',
        ts: '2020-01-01T00:00:00Z',
      });
      const recent = validMessage({
        id: 'recent-msg',
        ts: '2026-01-01T00:00:00Z',
      });
      await request('POST', '/inbox', old);
      await request('POST', '/inbox', recent);

      const res = await request('GET', '/inbox?since=2025-01-01T00:00:00Z');
      assert.equal(res.status, 200);
      const ids = res.body.map((m) => m.id);
      assert.ok(ids.includes('recent-msg'));
      assert.ok(!ids.includes('old-msg'));
    });
  });
});
