const mongoose = require('mongoose');
const applyJSON = require('./_json');
// One row per referred account. Eligibility is decided by recorded events, never by claims.
const schema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referred: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  code: { type: String, required: true },
  registeredAt: { type: Date, default: Date.now },
  emailVerifiedAt: Date,
  businessVerifiedAt: Date,
  activatedAt: Date,                    // first product approved and published
  eligible: { type: Boolean, default: false },
  ineligibleReason: { type: String, default: '', maxlength: 200 },
  rewardStatus: { type: String, enum: ['none', 'pending', 'granted', 'denied'], default: 'none' },
  signupIp: { type: String, default: '', maxlength: 64 }
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.Referral || mongoose.model('Referral', schema);
