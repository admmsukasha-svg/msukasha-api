const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  profile: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  slug: { type: String, required: true, unique: true, lowercase: true, maxlength: 180 },
  banner: { type: String, default: '' },
  intro: { type: String, default: '', maxlength: 2000 },
  contactPreferences: {
    allowInquiries: { type: Boolean, default: true },
    allowRfq: { type: Boolean, default: true },
    showPhone: { type: Boolean, default: false }
  },
  wholesale: {
    currencies: { type: [String], default: ['USD'] },
    shippingTerms: { type: String, default: '', maxlength: 500 },
    paymentTerms: { type: String, default: '', maxlength: 500 }
  },
  // Admin may suspend a store; only 'published' stores appear publicly.
  status: { type: String, enum: ['draft', 'published', 'suspended'], default: 'draft', index: true },
  publishedAt: Date
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.Store || mongoose.model('Store', schema);
