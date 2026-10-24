const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subject: { type: String, required: true, maxlength: 200 },
  category: { type: String, enum: ['account', 'listing', 'verification', 'rfq', 'report', 'other'], default: 'other' },
  status: { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  messages: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    staff: { type: Boolean, default: false },
    text: { type: String, maxlength: 3000 },
    at: { type: Date, default: Date.now }
  }]
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', schema);
