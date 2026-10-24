const mongoose = require('mongoose');
const applyJSON = require('./_json');

const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productKey: { type: String, default: '' },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, maxlength: 200 },
  price: { type: Number, required: true, min: 0 },
  qty: { type: Number, required: true, min: 1, max: 9999 }
}, { _id: false });

const schema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [itemSchema], validate: (v) => v.length > 0 },
  shipping: {
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    city: { type: String, default: '' },
    address: { type: String, default: '' }
  },
  // Card numbers are never collected or stored here. Use a payment gateway for cards.
  paymentMethod: { type: String, enum: ['cod', 'jazzcash', 'easypaisa', 'bank_transfer', 'card'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  status: { type: String, enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'pending', index: true },
  subtotal: { type: Number, required: true, min: 0 },
  shippingFee: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  note: { type: String, default: '', maxlength: 1000 }
}, { timestamps: true });

applyJSON(schema);
module.exports = mongoose.models.Order || mongoose.model('Order', schema);
