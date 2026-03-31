const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { createApp } = require('../server');

// Create a temp contacts DB for tests
function createTestContactsDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(os.tmpdir(), `amb-test-contacts-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      context TEXT,
      skills TEXT,
      notes TEXT,
      email TEXT,
      github TEXT,
      slack_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.prepare("INSERT INTO contacts (name, role) VALUES (?, ?)").run("Josue", "Coworker");
  db.prepare("INSERT INTO contacts (name, role) VALUES (?, ?)").run("Andy", "Coworker");
  db.prepare("INSERT INTO contacts (name, role) VALUES (?, ?)").run("Omar", "AI researcher");
  db.close();
  return dbPath;
}

describe('Dashboard API', () => {
  let server, baseUrl, contactsDbPath;
  const testConfig = { name: 'test-node', host: 'test-host', port: 0, dbPath: ':memory:' };
  const testPeers = {
    alice: { url: 'https://alice.ts.net:3141', secret: 'alice-secret-123' },
    bob: { url: 'https://bob.ts.net:3141', secret: 'bob-secret-456' },
  };

  before(async () => {
    contactsDbPath = createTestContactsDb();
    testConfig.contactsDb = contactsDbPath;
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
    try { fs.unlinkSync(contactsDbPath); } catch {}
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

    it('accepts optional contactId and includes it in peer list', async () => {
      const res = await fetch(`${baseUrl}/api/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'josue-node', url: 'https://josue.ts.net/amb', secret: 'josue-s', contactId: 1 }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.contactId, 1);
      assert.equal(data.contactName, 'Josue');
    });
  });

  describe('GET /api/contacts', () => {
    it('returns contacts from configured DB', async () => {
      const res = await fetch(`${baseUrl}/api/contacts`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.length >= 3);
      const josue = data.find(c => c.name === 'Josue');
      assert.ok(josue);
      assert.equal(josue.role, 'Coworker');
    });

    it('does not expose sensitive fields', async () => {
      const res = await fetch(`${baseUrl}/api/contacts`);
      const data = await res.json();
      for (const c of data) {
        assert.ok(c.id, 'should have id');
        assert.ok(c.name, 'should have name');
        // Should not expose email/slack_id by default
      }
    });

    it('supports search query param', async () => {
      const res = await fetch(`${baseUrl}/api/contacts?q=omar`);
      const data = await res.json();
      assert.equal(data.length, 1);
      assert.equal(data[0].name, 'Omar');
    });
  });

  describe('GET /api/contacts (no DB configured)', () => {
    let noDbServer, noDbUrl;

    before(async () => {
      const noContactsConfig = { name: 'no-contacts', host: 'test', port: 0, dbPath: ':memory:' };
      const app = createApp({ config: noContactsConfig, peers: {} });
      await new Promise((resolve) => {
        noDbServer = app.listen(0, () => {
          noDbUrl = `http://localhost:${noDbServer.address().port}`;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => noDbServer.close(resolve));
    });

    it('returns 404 when no contactsDb configured', async () => {
      const res = await fetch(`${noDbUrl}/api/contacts`);
      assert.equal(res.status, 404);
    });
  });

  describe('GET /api/settings', () => {
    it('returns current settings', async () => {
      const res = await fetch(`${baseUrl}/api/settings`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.name, 'test-node');
      assert.equal(data.host, 'test-host');
      assert.ok('contactsDb' in data);
    });

    it('does not expose dbPath', async () => {
      const res = await fetch(`${baseUrl}/api/settings`);
      const data = await res.json();
      assert.equal(data.dbPath, undefined);
    });
  });

  describe('PUT /api/settings', () => {
    it('updates contactsDb path', async () => {
      const newPath = '/tmp/test-new-contacts.db';
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactsDb: newPath }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.contactsDb, newPath);
    });

    it('setting contactsDb to empty string clears it', async () => {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactsDb: '' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.contactsDb, '');

      // contacts endpoint should now 404
      const contactsRes = await fetch(`${baseUrl}/api/contacts`);
      assert.equal(contactsRes.status, 404);
    });

    it('can create AMBcontacts.db when setting to "create"', async () => {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactsDb: 'create' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.contactsDb.includes('AMBcontacts.db'));

      // Should be usable now
      const contactsRes = await fetch(`${baseUrl}/api/contacts`);
      assert.equal(contactsRes.status, 200);

      // Clean up
      try { fs.unlinkSync(data.contactsDb); } catch {}
    });

    it('rejects unknown settings', async () => {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hackerField: 'nope' }),
      });
      assert.equal(res.status, 400);
    });
  });
});
