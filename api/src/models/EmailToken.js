const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['verify_email', 'reset_password'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  usedAt: Date,
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.EmailToken || mongoose.model('EmailToken', schema);
