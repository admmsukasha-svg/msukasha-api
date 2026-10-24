const crypto = require('crypto');

// Random URL-safe token (sent to the user) and its SHA-256 hash (stored in the database).
function newToken(bytes = 32) {
  const raw = crypto.randomBytes(bytes).toString('base64url');
  return { raw, hash: hashToken(raw) };
}
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// Short, unambiguous referral code (no 0/O/1/I).
function referralCode(len = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

module.exports = { newToken, hashToken, referralCode };
