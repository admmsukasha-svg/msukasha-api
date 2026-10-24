const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },        // product required
  specifications: { type: String, default: '', maxlength: 4000 },
  quantity: { type: Number, required: true, min: 1 },
  unit: { type: String, required: true, maxlength: 20 },
  targetPrice: { type: Number, min: 0 },
  currency: { type: String, enum: ['USD', 'PKR'], default: 'USD' },
  destinationCountry: { type: String, required: true, maxlength: 2 },
  destinationCity: { type: String, default: '', maxlength: 80 },
  requiredBy: Date,
  attachments: { type: [String], default: [] },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  // 'invited' = only chosen suppliers can see it. 'public' = eligible suppliers can browse it (buyer contact stays hidden).
  visibility: { type: String, enum: ['invited', 'public'], default: 'invited' },
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  status: { type: String, enum: ['open', 'closed', 'awarded', 'cancelled'], default: 'open', index: true },
  quotationCount: { type: Number, default: 0 },
  awardedQuotation: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation' }
}, { timestamps: true });
schema.index({ visibility: 1, status: 1, createdAt: -1 });
applyJSON(schema);
module.exports = mongoose.models.Rfq || mongoose.model('Rfq', schema);
