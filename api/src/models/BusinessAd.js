const mongoose = require('mongoose');
const applyJSON = require('./_json');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  advertiserName: { type: String, required: true, maxlength: 120 },
  businessName: { type: String, required: true, maxlength: 160 },
  email: { type: String, required: true, maxlength: 254, index: true },
  phone: { type: String, required: true, maxlength: 30 },
  package: { type: String, enum: ['starter', 'business', 'premium'], required: true },
  title: { type: String, required: true, maxlength: 150 },
  description: { type: String, required: true, maxlength: 3000 },
  targetUrl: { type: String, default: '' },
  imageUrl: { type: String, default: '' },

  status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired'], default: 'pending', index: true },
  rejectionReason: { type: String, default: '' },

  // price and duration are set by the server from config/packages.js
  amount: { type: Number, required: true, min: 0 },
  duration: { type: Number, required: true, min: 1 },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'pending_verification', 'paid', 'rejected'],
    default: 'unpaid',
    index: true
  },
  payment: {
    method: { type: String, default: '' },
    payerName: { type: String, default: '' },
    payerEmail: { type: String, default: '' },
    transactionId: { type: String, default: '', index: true },
    note: { type: String, default: '' },
    submittedAt: { type: Date }
  },

  startDate: { type: Date },
  endDate: { type: Date },
  priority: { type: Number, default: 0 },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },

  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 }
}, { timestamps: true });

schema.index({ status: 1, startDate: 1, endDate: 1 });
applyJSON(schema);
module.exports = mongoose.models.BusinessAd || mongoose.model('BusinessAd', schema);
