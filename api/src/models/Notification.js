const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true, maxlength: 40 },
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, default: '', maxlength: 500 },
  link: { type: String, default: '', maxlength: 300 },
  readAt: Date
}, { timestamps: true });
schema.index({ user: 1, createdAt: -1 });
applyJSON(schema);
module.exports = mongoose.models.Notification || mongoose.model('Notification', schema);
