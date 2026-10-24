const mongoose = require('mongoose');
const applyJSON = require('./_json');
// Conversation between exactly two users, linked to a real product / RFQ / C2C listing / support request.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },            // sorted(userA,userB)|refType|refId
  participants: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], validate: (v) => v.length === 2 },
  refType: { type: String, enum: ['product', 'rfq', 'c2c', 'supplier', 'support'], required: true },
  refId: { type: String, default: '', maxlength: 60 },
  subject: { type: String, default: '', maxlength: 200 },
  lastMessageAt: { type: Date, default: Date.now },
  lastMessageText: { type: String, default: '', maxlength: 140 },
  unread: { type: Map, of: Number, default: {} },
  blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });
schema.index({ participants: 1, lastMessageAt: -1 });
applyJSON(schema);
module.exports = mongoose.models.Conversation || mongoose.model('Conversation', schema);
