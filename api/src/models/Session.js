const mongoose = require('mongoose');
// Server-side session record so sessions can be revoked (logout, password change).
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jti: { type: String, required: true, unique: true },
  userAgent: { type: String, default: '', maxlength: 200 },
  ip: { type: String, default: '', maxlength: 64 },
  revokedAt: Date,
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.Session || mongoose.model('Session', schema);
