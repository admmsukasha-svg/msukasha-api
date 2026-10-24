const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 80 },
  value: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });
module.exports = mongoose.models.Setting || mongoose.model('Setting', schema);
