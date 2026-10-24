const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  actorRole: { type: String, default: '', maxlength: 30 },
  action: { type: String, required: true, maxlength: 80, index: true },
  targetType: { type: String, default: '', maxlength: 30 },
  targetId: { type: String, default: '', maxlength: 60 },
  onBehalfOf: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },   // admin-assisted onboarding
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '', maxlength: 64 }
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ createdAt: -1 });
applyJSON(schema);
module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', schema);
