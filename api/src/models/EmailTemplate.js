const mongoose = require('mongoose');
const applyJSON = require('./_json');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 60 },
  subject: { type: String, required: true, maxlength: 200 },
  body: { type: String, required: true, maxlength: 5000 },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });
applyJSON(schema);
module.exports = mongoose.models.EmailTemplate || mongoose.model('EmailTemplate', schema);
