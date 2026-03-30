const Database = require('better-sqlite3');

let db = null;

/**
 * Initialize (or re-initialize) the SQLite database.
 * @param {string} dbPath  File path or ":memory:" for testing
 */
function init(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      "from"      TEXT NOT NULL,
      "to"        TEXT NOT NULL,
      thread      TEXT,
      type        TEXT NOT NULL,
      body        TEXT NOT NULL,
      ts          TEXT NOT NULL,
      sig         TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

/**
 * Close the database connection.
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Store a message envelope. Returns the row as stored (with received_at).
 */
function saveMessage(msg) {
  const stmt = db.prepare(`
    INSERT INTO messages (id, "from", "to", thread, type, body, ts, sig)
    VALUES (@id, @from, @to, @thread, @type, @body, @ts, @sig)
  `);
  stmt.run({
    id: msg.id,
    from: msg.from,
    to: msg.to,
    thread: msg.thread ?? null,
    type: msg.type,
    body: msg.body,
    ts: msg.ts,
    sig: msg.sig,
  });

  return db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(msg.id);
}

/**
 * Retrieve messages, optionally after a given ISO-8601 timestamp.
 * Ordered by ts ascending.
 */
function getMessages(since) {
  if (since) {
    return db
      .prepare('SELECT * FROM messages WHERE ts > ? ORDER BY ts ASC')
      .all(since);
  }
  return db.prepare('SELECT * FROM messages ORDER BY ts ASC').all();
}

module.exports = { init, close, saveMessage, getMessages };
