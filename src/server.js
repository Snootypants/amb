const express = require('express');
const path = require('node:path');
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

  return app;
}

// ── Standalone startup ─────────────────────────────────────────
if (require.main === module) {
  const config = require('./config.json');
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`AMB node ${config.name}@${config.host} listening on :${config.port}`);
  });
}

module.exports = { createApp };
