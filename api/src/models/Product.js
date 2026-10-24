const mongoose = require('mongoose');
const applyJSON = require('./_json');

const tierSchema = new mongoose.Schema({
  minQty: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 }
}, { _id: false });

const specSchema = new mongoose.Schema({
  key: { type: String, maxlength: 60 }, value: { type: String, maxlength: 200 }
}, { _id: false });

// Lifecycle: draft -> pending_review -> active (published) | rejected ; active <-> paused ; any -> archived.
// "active" keeps its legacy meaning (publicly visible), so existing products stay visible.
const STATUSES = ['draft', 'pending_review', 'active', 'rejected', 'paused', 'archived', 'inactive'];

const schema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, index: true, maxlength: 240 },
  short: { type: String, default: '', maxlength: 100 },
  description: { type: String, default: '', maxlength: 5000 },
  type: { type: String, enum: ['b2b', 'c2c'], default: 'b2b' },
  cat: { type: String, default: '', maxlength: 50 },                         // legacy free-text category key
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  price: { type: Number, min: 0 },                                           // optional: quotation-based products have no fixed price
  priceOnRequest: { type: Boolean, default: false },
  currency: { type: String, enum: ['USD', 'PKR'], default: 'USD' },
  priceTiers: { type: [tierSchema], default: [] },
  unit: { type: String, default: 'pc', maxlength: 20 },
  moq: { type: Number, default: 1, min: 1 },
  stock: { type: Number, default: 0, min: 0 },
  availableQuantity: { type: Number, min: 0 },
  leadTimeDays: { type: Number, min: 0, max: 730 },
  sampleAvailable: { type: Boolean, default: false },
  customization: { type: String, default: '', maxlength: 500 },
  shippingTerms: { type: String, default: '', maxlength: 500 },
  originCountry: { type: String, default: '', maxlength: 2 },
  specifications: { type: [specSchema], default: [] },
  variations: { type: [{ name: { type: String, maxlength: 60 }, options: { type: [String], default: [] } }], default: [] },
  location: { type: String, default: '', maxlength: 120 },
  country: { type: String, default: '', maxlength: 2, index: true },
  city: { type: String, default: '', maxlength: 80, index: true },
  img: { type: String, default: '' },
  fallback: { type: String, default: '' },
  images: { type: [String], default: [] },
  status: { type: String, enum: STATUSES, default: 'draft', index: true },
  rejectionReason: { type: String, default: '', maxlength: 500 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  publishedAt: Date,
  views: { type: Number, default: 0 }
}, { timestamps: true });

schema.statics.STATUSES = STATUSES;
schema.index({ status: 1, type: 1, category: 1, createdAt: -1 });
schema.index({ status: 1, country: 1, city: 1 });
schema.index({ status: 1, price: 1 });
schema.index({ name: 'text', short: 'text', description: 'text' }, { weights: { name: 10, short: 4, description: 1 } });
applyJSON(schema);
module.exports = mongoose.models.Product || mongoose.model('Product', schema);
