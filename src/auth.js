const crypto = require('node:crypto');

/**
 * Produce canonical JSON for HMAC signing.
 * Keys sorted alphabetically, "sig" field excluded.
 */
function canonicalize(payload) {
  const keys = Object.keys(payload)
    .filter((k) => k !== 'sig')
    .sort();
  const obj = {};
  for (const k of keys) obj[k] = payload[k];
  return JSON.stringify(obj);
}

/**
 * Sign a payload with HMAC-SHA256.
 * Returns lowercase hex digest.
 */
function sign(payload, secret) {
  const data = canonicalize(payload);
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature against a payload.
 * Uses timing-safe comparison.
 */
function verify(payload, sig, secret) {
  const expected = sign(payload, secret);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

module.exports = { canonicalize, sign, verify };
