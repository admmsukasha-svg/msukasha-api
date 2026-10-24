const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });
module.exports = mongoose.models.Wishlist || mongoose.model('Wishlist', schema);
