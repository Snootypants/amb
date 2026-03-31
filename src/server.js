const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { verify } = require('./auth');
const store = require('./store');

const MAX_BODY_BYTES = 64 * 1024; // 64 KB

/**
 * Create and return an Express app.
 * Accepts optional overrides for config and peers (used by tests).
 */
function createApp(opts = {}) {
  const config = opts.config || require('./config.json');
  const peers = opts.peers || require('./peers.json');

  // Initialize SQLite store
  store.init(config.dbPath);

  const app = express();

  // Serve static dashboard files
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(express.json({ limit: '64kb' }));

  // ── Handle body-parser errors (413, malformed JSON, etc.) ──
  app.use((err, _req, res, next) => {
    if (err.status === 413) {
      return res.status(413).json({ error: 'Payload Too Large' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
  });

  // ── GET /health ────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      node: `${config.name}@${config.host}`,
    });
  });

  // ── POST /inbox ────────────────────────────────────────────
  app.post('/inbox', (req, res) => {
    const msg = req.body;

    // Must have a sig
    if (!msg || !msg.sig) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    // Look up peer by "from" field  (name@host → name)
    const peerName = (msg.from || '').split('@')[0];
    const peer = peers[peerName];
    if (!peer) {
      return res.status(401).json({ error: 'Unknown peer' });
    }

    // Verify HMAC
    if (!verify(msg, msg.sig, peer.secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Store
    const saved = store.saveMessage(msg);
    return res.status(202).json(saved);
  });

  // ── GET /inbox ─────────────────────────────────────────────
  app.get('/inbox', (req, res) => {
    const since = req.query.since || null;
    const messages = store.getMessages(since);
    res.json(messages);
  });

  // ── Dashboard API ───────────────────────────────────────────

  // GET /api/node — non-sensitive node identity info
  app.get('/api/node', (_req, res) => {
    res.json({
      name: config.name,
      host: config.host,
      port: config.port,
      nodeId: `${config.name}@${config.host}`,
    });
  });

  // GET /api/peers — peer names and URLs (no secrets)
  app.get('/api/peers', (_req, res) => {
    const list = Object.entries(peers).map(([name, peer]) => ({
      name,
      url: peer.url,
    }));
    res.json(list);
  });

  // POST /api/peers — accept a peer (add to live peers + write to peers.json)
  app.post('/api/peers', (req, res) => {
    const { name, url, secret, contactId } = req.body || {};
    if (!name || !url || !secret) {
      return res.status(400).json({ error: 'Missing required fields: name, url, secret' });
    }

    // Add to live peers object so inbox auth works immediately
    const peerEntry = { url, secret };
    if (contactId) peerEntry.contactId = contactId;
    peers[name] = peerEntry;

    // Persist to peers.json (if we have a real file path)
    if (opts.peersPath) {
      const fs = require('node:fs');
      const current = JSON.parse(fs.readFileSync(opts.peersPath, 'utf-8'));
      current[name] = peerEntry;
      fs.writeFileSync(opts.peersPath, JSON.stringify(current, null, 2) + '\n');
    }

    // Look up contact name if contactId provided and contactsDb configured
    let contactName;
    if (contactId && config.contactsDb) {
      try {
        const Database = require('better-sqlite3');
        const cdb = new Database(config.contactsDb, { readonly: true });
        const row = cdb.prepare('SELECT name FROM contacts WHERE id = ?').get(contactId);
        if (row) contactName = row.name;
        cdb.close();
      } catch {}
    }

    const result = { name, url };
    if (contactId) result.contactId = contactId;
    if (contactName) result.contactName = contactName;
    res.status(201).json(result);
  });

  // GET /api/contacts — list contacts from configured contacts DB
  app.get('/api/contacts', (req, res) => {
    if (!config.contactsDb) {
      return res.status(404).json({ error: 'No contactsDb configured. Set contactsDb in config.json or the app will create AMBcontacts.db.' });
    }

    try {
      const Database = require('better-sqlite3');
      const fs = require('node:fs');

      // If the configured path doesn't exist, create AMBcontacts.db in the app directory
      let dbPath = config.contactsDb;
      if (!fs.existsSync(dbPath)) {
        dbPath = path.join(__dirname, 'AMBcontacts.db');
        config.contactsDb = dbPath;
        const db = new Database(dbPath);
        db.exec(`
          CREATE TABLE IF NOT EXISTS contacts (
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
        db.close();
      }

      const cdb = new Database(dbPath, { readonly: true });
      const q = req.query.q;
      let rows;
      if (q) {
        const like = `%${q.toLowerCase()}%`;
        rows = cdb.prepare('SELECT id, name, role, context, github FROM contacts WHERE lower(name) LIKE ? OR lower(role) LIKE ? ORDER BY name ASC').all(like, like);
      } else {
        rows = cdb.prepare('SELECT id, name, role, context, github FROM contacts ORDER BY name ASC').all();
      }
      cdb.close();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/invite/:peerName — generate invite message with shared secret
  app.get('/api/invite/:peerName', (req, res) => {
    const peerName = req.params.peerName;
    const secret = crypto.randomBytes(32).toString('hex');
    const nodeUrl = req.query.url || `http://${config.host}:${config.port}`;

    const message = `Hey — here's what you need to add me as a peer in your AMB node:

Add this to your peers.json:
{
  "${config.name}": {
    "url": "${nodeUrl}/amb",
    "secret": "${secret}"
  }
}

I've added you on my end. Once you're running, hit my /health endpoint to verify: ${nodeUrl}/health`;

    res.json({
      peerName,
      nodeName: config.name,
      secret,
      nodeUrl,
      message,
    });
  });

  return app;
}

// ── Standalone startup ─────────────────────────────────────────
if (require.main === module) {
  const config = require('./config.json');
  const app = createApp({ peersPath: path.join(__dirname, 'peers.json') });
  app.listen(config.port, () => {
    console.log(`AMB node ${config.name}@${config.host} listening on :${config.port}`);
  });
}

module.exports = { createApp };
