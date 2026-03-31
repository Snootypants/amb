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
    const { name, url, secret } = req.body || {};
    if (!name || !url || !secret) {
      return res.status(400).json({ error: 'Missing required fields: name, url, secret' });
    }

    // Add to live peers object so inbox auth works immediately
    peers[name] = { url, secret };

    // Persist to peers.json (if we have a real file path)
    if (opts.peersPath) {
      const fs = require('node:fs');
      const current = JSON.parse(fs.readFileSync(opts.peersPath, 'utf-8'));
      current[name] = { url, secret };
      fs.writeFileSync(opts.peersPath, JSON.stringify(current, null, 2) + '\n');
    }

    res.status(201).json({ name, url });
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
