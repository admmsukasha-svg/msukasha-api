const mongoose = require('mongoose');
const applyJSON = require('./_json');

const BUSINESS_TYPES = ['manufacturer', 'wholesaler', 'distributor', 'exporter', 'trading_company', 'retailer', 'service_provider', 'individual'];

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessType: { type: String, enum: BUSINESS_TYPES, required: true, index: true },
  companyName: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, unique: true, lowercase: true, maxlength: 180 },
  description: { type: String, default: '', maxlength: 3000 },
  country: { type: String, default: '', maxlength: 2, index: true },
  city: { type: String, default: '', maxlength: 80, index: true },
  website: { type: String, default: '', maxlength: 300 },
  phone: { type: String, default: '', maxlength: 30 },
  email: { type: String, default: '', maxlength: 254 },
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  yearEstablished: { type: Number, min: 1800, max: 2100 },
  logo: { type: String, default: '' },
  photos: { type: [String], default: [] },
  // PRIVATE fields: never returned by public endpoints (see publicProfile()).
  address: { type: String, default: '', maxlength: 300 },
  registrationNumber: { type: String, default: '', maxlength: 60 },
  taxId: { type: String, default: '', maxlength: 60 },
  onboardingStep: { type: Number, default: 1 }
}, { timestamps: true });

schema.index({ companyName: 'text', description: 'text' }, { weights: { companyName: 10, description: 1 } });

schema.statics.PRIVATE_FIELDS = ['address', 'registrationNumber', 'taxId', 'owner', 'email', 'phone'];
schema.statics.BUSINESS_TYPES = BUSINESS_TYPES;

// Profile completion indicator based on real filled fields.
schema.methods.completion = function completion() {
  const checks = {
    'Company name': !!this.companyName,
    'Business description (50+ characters)': (this.description || '').length >= 50,
    'Country and city': !!(this.country && this.city),
    'Business phone or email': !!(this.phone || this.email),
    'Main product categories': (this.categories || []).length > 0,
    'Company logo': !!this.logo,
    'Business photo': (this.photos || []).length > 0
  };
  const done = Object.values(checks).filter(Boolean).length;
  return { percent: Math.round((done / Object.keys(checks).length) * 100), missing: Object.keys(checks).filter((k) => !checks[k]) };
};

applyJSON(schema);
module.exports = mongoose.models.BusinessProfile || mongoose.model('BusinessProfile', schema);
