const mongoose = require('mongoose');
const applyJSON = require('./_json');

const schema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true, maxlength: 120 },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 2000 }
}, { timestamps: true });

schema.index({ conversationId: 1, createdAt: 1 });
applyJSON(schema);
module.exports = mongoose.models.Message || mongoose.model('Message', schema);
