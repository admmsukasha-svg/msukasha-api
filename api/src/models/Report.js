const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['product', 'supplier', 'c2c', 'user', 'conversation'], required: true },
  targetId: { type: String, required: true, maxlength: 60 },
  reason: { type: String, enum: ['suspicious', 'counterfeit', 'prohibited_item', 'misleading', 'spam', 'harassment', 'other'], required: true },
  details: { type: String, default: '', maxlength: 2000 },
  status: { type: String, enum: ['open', 'reviewing', 'actioned', 'dismissed'], default: 'open', index: true },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolution: { type: String, default: '', maxlength: 1000 }
}, { timestamps: true });
schema.index({ targetType: 1, targetId: 1 });
schema.index({ reporter: 1, targetType: 1, targetId: 1 }, { unique: true });   // one open report per user per target
applyJSON(schema);
module.exports = mongoose.models.Report || mongoose.model('Report', schema);
