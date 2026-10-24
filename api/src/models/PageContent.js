const mongoose = require('mongoose');
const applyJSON = require('./_json');
// Admin-managed policy / informational pages (terms, privacy, seller guidelines, ...).
const schema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, maxlength: 80 },
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, default: '', maxlength: 60000 },
  published: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.PageContent || mongoose.model('PageContent', schema);
