const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['product', 'supplier', 'c2c'], required: true },
  ref: { type: mongoose.Schema.Types.ObjectId, required: true }
}, { timestamps: true });
schema.index({ user: 1, kind: 1, ref: 1 }, { unique: true });
applyJSON(schema);
module.exports = mongoose.models.Favorite || mongoose.model('Favorite', schema);
