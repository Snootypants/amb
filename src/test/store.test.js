const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { init, close, saveMessage, getMessages } = require('../store');

describe('store', () => {
  beforeEach(() => {
    // Use in-memory SQLite for isolation
    init(':memory:');
  });

  afterEach(() => {
    close();
  });

  it('init() creates the messages table', () => {
    // If init didn't throw we're good, but also verify we can query
    const msgs = getMessages();
    assert.deepEqual(msgs, []);
  });

  it('saveMessage() stores a message and returns it', () => {
    const msg = {
      id: 'aaa-bbb-ccc',
      from: 'ember@calebs-mac',
      to: 'jane@zimacube',
      thread: null,
      type: 'message',
      body: 'hello world',
      ts: '2025-03-30T12:00:00Z',
      sig: 'abc123',
    };
    const saved = saveMessage(msg);
    assert.equal(saved.id, msg.id);
    assert.equal(saved.body, msg.body);
    assert.ok(saved.received_at, 'should have received_at timestamp');
  });

  it('getMessages() returns all messages when no since param', () => {
    const m1 = makeMsg('1', '2025-03-30T10:00:00Z');
    const m2 = makeMsg('2', '2025-03-30T11:00:00Z');
    saveMessage(m1);
    saveMessage(m2);

    const msgs = getMessages();
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].id, '1');
    assert.equal(msgs[1].id, '2');
  });

  it('getMessages(since) returns only messages after the timestamp', () => {
    const m1 = makeMsg('1', '2025-03-30T10:00:00Z');
    const m2 = makeMsg('2', '2025-03-30T11:00:00Z');
    const m3 = makeMsg('3', '2025-03-30T12:00:00Z');
    saveMessage(m1);
    saveMessage(m2);
    saveMessage(m3);

    const msgs = getMessages('2025-03-30T10:30:00Z');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].id, '2');
    assert.equal(msgs[1].id, '3');
  });

  it('getMessages() orders by ts ascending', () => {
    // Insert out of order
    saveMessage(makeMsg('late', '2025-03-30T15:00:00Z'));
    saveMessage(makeMsg('early', '2025-03-30T09:00:00Z'));
    saveMessage(makeMsg('mid', '2025-03-30T12:00:00Z'));

    const msgs = getMessages();
    assert.equal(msgs[0].id, 'early');
    assert.equal(msgs[1].id, 'mid');
    assert.equal(msgs[2].id, 'late');
  });

  it('duplicate id is rejected (UNIQUE constraint)', () => {
    const msg = makeMsg('dup', '2025-03-30T10:00:00Z');
    saveMessage(msg);
    assert.throws(() => saveMessage(msg));
  });

  it('thread can be null', () => {
    const msg = makeMsg('no-thread', '2025-03-30T10:00:00Z');
    msg.thread = null;
    const saved = saveMessage(msg);
    assert.equal(saved.thread, null);
  });
});

/** Helper to build a minimal message envelope */
function makeMsg(id, ts) {
  return {
    id,
    from: 'ember@calebs-mac',
    to: 'jane@zimacube',
    thread: 'thread-1',
    type: 'message',
    body: `body of ${id}`,
    ts,
    sig: 'sig-placeholder',
  };
}
