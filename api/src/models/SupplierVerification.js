const mongoose = require('mongoose');
const applyJSON = require('./_json');

const decisionSchema = new mongoose.Schema({
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  level: { type: String, enum: ['business_documents', 'additional'], required: true },
  decision: { type: String, enum: ['approved', 'rejected', 'resubmit'], required: true },
  reason: { type: String, default: '', maxlength: 1000 },
  at: { type: Date, default: Date.now }
}, { _id: false });

const docSchema = new mongoose.Schema({
  kind: { type: String, enum: ['business_registration', 'tax_certificate', 'identity_document', 'trade_license', 'other'], required: true },
  publicId: { type: String, required: true, maxlength: 300 },   // private storage id; never exposed publicly
  format: { type: String, default: '', maxlength: 10 },
  uploadedAt: { type: Date, default: Date.now }
});

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  profile: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  documents: [docSchema],
  documentsStatus: { type: String, enum: ['none', 'submitted', 'approved', 'rejected', 'resubmit'], default: 'none', index: true },
  // "Additional verification" exists only if a real review process (e.g. video call, site visit) was carried out.
  additionalStatus: { type: String, enum: ['none', 'approved'], default: 'none' },
  additionalNote: { type: String, default: '', maxlength: 500 },
  decisions: [decisionSchema],
  submittedAt: Date
}, { timestamps: true });

// Public verification levels, derived ONLY from completed checks.
schema.statics.levelsFor = function levelsFor(user, v) {
  const levels = [];
  if (user && user.emailVerified) levels.push('email_verified');
  if (user && user.phoneVerified) levels.push('phone_verified');
  if (v && v.documentsStatus === 'approved') levels.push('business_documents_reviewed');
  if (v && v.additionalStatus === 'approved') levels.push('additional_verification');
  return levels;
};

applyJSON(schema);
module.exports = mongoose.models.SupplierVerification || mongoose.model('SupplierVerification', schema);
