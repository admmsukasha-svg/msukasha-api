const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, unique: true, lowercase: true, maxlength: 120 },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
  description: { type: String, default: '', maxlength: 500 },
  icon: { type: String, default: '', maxlength: 60 },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true, index: true },
  // Some categories are restricted (e.g. medical supplies): sellers must be reviewed first.
  restricted: { type: Boolean, default: false }
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.Category || mongoose.model('Category', schema);
