const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  rfq: { type: mongoose.Schema.Types.ObjectId, ref: 'Rfq', required: true, index: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  unitPrice: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ['USD', 'PKR'], required: true },
  moq: { type: Number, min: 1 },
  availableQuantity: { type: Number, min: 0 },
  leadTimeDays: { type: Number, min: 0, max: 730 },
  shippingDetails: { type: String, default: '', maxlength: 1000 },
  validUntil: { type: Date, required: true },
  terms: { type: String, default: '', maxlength: 2000 },
  status: { type: String, enum: ['submitted', 'accepted', 'rejected', 'withdrawn'], default: 'submitted' }
}, { timestamps: true });
schema.index({ rfq: 1, supplier: 1 }, { unique: true });   // one live quotation per supplier per RFQ
applyJSON(schema);
module.exports = mongoose.models.Quotation || mongoose.model('Quotation', schema);
