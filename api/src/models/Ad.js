const mongoose = require('mongoose');
const applyJSON = require('./_json');

// C2C classified ads (msukasha.com). Moderated: new ads start as "pending".
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 5000 },
  price: { type: Number, default: 0, min: 0 },
  cat: { type: String, default: '', maxlength: 50 },
  location: { type: String, default: '', maxlength: 120 },
  phone: { type: String, default: '', maxlength: 30 },
  email: { type: String, default: '', maxlength: 254 },
  images: { type: [String], default: [] },
  img: { type: String, default: '' },
  condition: { type: String, enum: ['new', 'used', 'refurbished'], default: 'used' },
  city: { type: String, default: '', maxlength: 80, index: true },
  currency: { type: String, default: 'PKR', enum: ['PKR'] },
  expiresAt: { type: Date, index: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'sold', 'removed'], default: 'pending', index: true },
  rejectionReason: { type: String, default: '' }
}, { timestamps: true });

applyJSON(schema);
module.exports = mongoose.models.Ad || mongoose.model('Ad', schema);
