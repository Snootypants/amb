const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sign, verify, canonicalize } = require('../auth');

describe('canonicalize', () => {
  it('sorts keys alphabetically and excludes "sig"', () => {
    const payload = {
      to: 'jane@zimacube',
      sig: 'should-be-excluded',
      from: 'ember@calebs-mac',
      body: 'hello',
      id: '123',
    };
    const canon = canonicalize(payload);
    const parsed = JSON.parse(canon);

    // sig must be stripped
    assert.equal(parsed.sig, undefined);

    // keys must be sorted
    const keys = Object.keys(parsed);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted);
  });

  it('produces identical output regardless of insertion order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    assert.equal(canonicalize(a), canonicalize(b));
  });
});

describe('sign', () => {
  it('returns a hex string', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    const sig = sign(payload, 'test-secret');
    assert.match(sig, /^[0-9a-f]{64}$/);
  });

  it('is deterministic — same payload+secret → same sig', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    const s1 = sign(payload, 'test-secret');
    const s2 = sign(payload, 'test-secret');
    assert.equal(s1, s2);
  });

  it('changes when the payload changes', () => {
    const p1 = { from: 'ember@calebs-mac', body: 'hello' };
    const p2 = { from: 'ember@calebs-mac', body: 'goodbye' };
    assert.notEqual(sign(p1, 'test-secret'), sign(p2, 'test-secret'));
  });

  it('changes when the secret changes', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    assert.notEqual(sign(payload, 'secret-a'), sign(payload, 'secret-b'));
  });

  it('ignores an existing sig field in the payload', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    const withSig = { ...payload, sig: 'garbage' };
    assert.equal(sign(payload, 'test-secret'), sign(withSig, 'test-secret'));
  });
});

describe('verify', () => {
  it('returns true for a valid signature', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    const sig = sign(payload, 'test-secret');
    assert.equal(verify(payload, sig, 'test-secret'), true);
  });

  it('returns false for a tampered payload', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    const sig = sign(payload, 'test-secret');
    const tampered = { ...payload, body: 'hacked' };
    assert.equal(verify(tampered, sig, 'test-secret'), false);
  });

  it('returns false for wrong secret', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    const sig = sign(payload, 'test-secret');
    assert.equal(verify(payload, sig, 'wrong-secret'), false);
  });

  it('returns false for garbage sig', () => {
    const payload = { from: 'ember@calebs-mac', body: 'hello' };
    assert.equal(verify(payload, 'not-a-real-sig', 'test-secret'), false);
  });
});
