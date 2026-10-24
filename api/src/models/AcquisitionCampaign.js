const mongoose = require('mongoose');
const applyJSON = require('./_json');
const inviteSchema = new mongoose.Schema({
  contactName: { type: String, maxlength: 120 },
  contactEmail: { type: String, maxlength: 254, lowercase: true },
  consentBasis: { type: String, required: true, maxlength: 200 },   // how consent / lawful basis was obtained (required)
  status: { type: String, enum: ['invited', 'registered', 'activated', 'verified', 'retained', 'declined', 'unsubscribed'], default: 'invited' },
  invitedAt: { type: Date, default: Date.now },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true });
const schema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 160 },
  source: { type: String, required: true, lowercase: true, maxlength: 60, unique: true },   // value used in ?src=
  channel: { type: String, enum: ['email', 'whatsapp', 'event', 'partner', 'social', 'referral', 'other'], default: 'other' },
  notes: { type: String, default: '', maxlength: 2000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  invitations: [inviteSchema]
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.AcquisitionCampaign || mongoose.model('AcquisitionCampaign', schema);
