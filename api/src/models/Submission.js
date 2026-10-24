const mongoose = require('mongoose');
const applyJSON = require('./_json');

// Contact, job application, verification, partner and book-call forms.
const schema = new mongoose.Schema({
  type: { type: String, enum: ['contact', 'job-application', 'verification', 'partner', 'book-call'], required: true, index: true },
  name: { type: String, default: '', maxlength: 160 },
  email: { type: String, default: '', maxlength: 254 },
  phone: { type: String, default: '', maxlength: 30 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['new', 'in_progress', 'done'], default: 'new' }
}, { timestamps: true });

applyJSON(schema);
module.exports = mongoose.models.Submission || mongoose.model('Submission', schema);
