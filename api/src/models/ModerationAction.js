const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  moderator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, required: true, maxlength: 30 },
  targetId: { type: String, required: true, maxlength: 60 },
  action: { type: String, enum: ['approve', 'reject', 'suspend', 'remove', 'restore', 'warn'], required: true },
  reason: { type: String, default: '', maxlength: 1000 },
  report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' }
}, { timestamps: true });
schema.index({ targetType: 1, targetId: 1, createdAt: -1 });
applyJSON(schema);
module.exports = mongoose.models.ModerationAction || mongoose.model('ModerationAction', schema);
