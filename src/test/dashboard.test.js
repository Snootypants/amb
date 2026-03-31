const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

describe('Dashboard API', () => {
  let server, baseUrl;
  const testConfig = { name: 'test-node', host: 'test-host', port: 0, dbPath: ':memory:' };
  const testPeers = {
    alice: { url: 'https://alice.ts.net:3141', secret: 'alice-secret-123' },
    bob: { url: 'https://bob.ts.net:3141', secret: 'bob-secret-456' },
  };

  before(async () => {
    const app = createApp({ config: testConfig, peers: testPeers });
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe('GET /api/node', () => {
    it('returns node identity info', async () => {
      const res = await fetch(`${baseUrl}/api/node`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.name, 'test-node');
      assert.equal(data.host, 'test-host');
      assert.equal(data.nodeId, 'test-node@test-host');
    });

    it('does not expose dbPath', async () => {
      const res = await fetch(`${baseUrl}/api/node`);
      const data = await res.json();
      assert.equal(data.dbPath, undefined);
    });
  });

  describe('GET /api/peers', () => {
    it('returns peer names and URLs', async () => {
      const res = await fetch(`${baseUrl}/api/peers`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.length, 2);
      assert.equal(data[0].name, 'alice');
      assert.equal(data[0].url, 'https://alice.ts.net:3141');
      assert.equal(data[1].name, 'bob');
    });

    it('does not expose secrets', async () => {
      const res = await fetch(`${baseUrl}/api/peers`);
      const data = await res.json();
      for (const peer of data) {
        assert.equal(peer.secret, undefined);
      }
    });
  });

  describe('GET /api/invite/:peerName', () => {
    it('generates invite with secret and message', async () => {
      const res = await fetch(`${baseUrl}/api/invite/josh`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.peerName, 'josh');
      assert.equal(data.nodeName, 'test-node');
      assert.ok(data.secret);
      assert.ok(data.secret.length >= 32);
      assert.ok(data.nodeUrl);
      assert.ok(data.message);
      assert.ok(data.message.includes(data.secret));
      assert.ok(data.message.includes('test-node'));
    });

    it('uses custom URL when provided', async () => {
      const customUrl = 'https://my-tailscale.ts.net:3141';
      const res = await fetch(`${baseUrl}/api/invite/josh?url=${encodeURIComponent(customUrl)}`);
      const data = await res.json();
      assert.equal(data.nodeUrl, customUrl);
      assert.ok(data.message.includes(customUrl));
    });

    it('generates unique secrets per request', async () => {
      const res1 = await fetch(`${baseUrl}/api/invite/josh`);
      const res2 = await fetch(`${baseUrl}/api/invite/josh`);
      const data1 = await res1.json();
      const data2 = await res2.json();
      assert.notEqual(data1.secret, data2.secret);
    });
  });

  describe('POST /api/peers', () => {
    it('adds a new peer and returns it', async () => {
      const res = await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'charlie', url: 'https://charlie.ts.net:3141/amb', secret: 'charlie-secret-789' }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.name, 'charlie');
      assert.equal(data.url, 'https://charlie.ts.net:3141/amb');
    });

    it('does not expose secret in response', async () => {
      const res = await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'dave', url: 'https://dave.ts.net:3141/amb', secret: 'dave-secret' }),
      });
      const data = await res.json();
      assert.equal(data.secret, undefined);
    });

    it('new peer appears in GET /api/peers', async () => {
      // Add peer
      await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'eve', url: 'https://eve.ts.net:3141/amb', secret: 'eve-secret' }),
      });

      // Check it shows up
      const res = await fetch(`${baseUrl}/api/peers`);
      const peers = await res.json();
      const eve = peers.find(p => p.name === 'eve');
      assert.ok(eve, 'eve should appear in peer list');
      assert.equal(eve.url, 'https://eve.ts.net:3141/amb');
    });

    it('rejects if name is missing', async () => {
      const res = await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://x.ts.net/amb', secret: 'x' }),
      });
      assert.equal(res.status, 400);
    });

    it('rejects if url is missing', async () => {
      const res = await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', secret: 'x' }),
      });
      assert.equal(res.status, 400);
    });

    it('rejects if secret is missing', async () => {
      const res = await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', url: 'https://x.ts.net/amb' }),
      });
      assert.equal(res.status, 400);
    });

    it('new peer can send messages to inbox', async () => {
      const secret = 'frank-secret-abc';
      // Add peer
      await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'frank', url: 'https://frank.ts.net/amb', secret }),
      });

      // Send a signed message as frank
      const { sign } = require('../auth');
      const msg = {
        id: require('node:crypto').randomUUID(),
        from: 'frank@franks-mac',
        to: 'test-node@test-host',
        thread: null,
        type: 'message',
        body: 'hello from frank',
        ts: new Date().toISOString(),
      };
      msg.sig = sign(msg, secret);

      const res = await fetch(`${baseUrl}/inbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      assert.equal(res.status, 202, 'newly added peer should be able to send messages');
    });
  });
});
