const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  firstName: { type: String, default: '', maxlength: 60 },
  lastName: { type: String, default: '', maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  phone: { type: String, default: '', maxlength: 30 },
  phoneVerified: { type: Boolean, default: false },
  city: { type: String, default: '', maxlength: 80 },
  country: { type: String, default: '', maxlength: 2 },          // ISO 3166-1 alpha-2
  language: { type: String, default: 'en', maxlength: 8 },
  companyName: { type: String, default: '', maxlength: 160 },
  role: { type: String, enum: ['buyer', 'seller', 'admin'], default: 'buyer' },
  staffRoles: { type: [String], enum: ['super_admin', 'moderator', 'verification_reviewer', 'support_agent'], default: [] },
  accountType: { type: String, default: 'buyer' },
  profile: {
    about: { type: String, default: '', maxlength: 1000 },
    address: { type: String, default: '', maxlength: 300 },
    joinedAt: { type: Date, default: Date.now }
  },
  emailVerified: { type: Boolean, default: false },
  emailVerifiedAt: Date,
  termsAcceptedAt: Date,
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acquisitionSource: { type: String, default: '', maxlength: 60 },
  notificationPrefs: {
    email: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false }       // consent-based communications only
  },
  assistConsentUntil: Date,                                 // user allowed staff to help set up their profile
  failedLogins: { type: Number, default: 0 },
  lockUntil: Date,
  lastLoginAt: Date,
  isActive: { type: Boolean, default: true },
  deletedAt: Date
}, { timestamps: true });

// Public JSON never includes secrets. "uid" is kept for the legacy static frontend.
schema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = String(ret._id);
    ret.uid = ret.id;
    delete ret._id; delete ret.__v; delete ret.passwordHash; delete ret.failedLogins; delete ret.lockUntil;
    return ret;
  }
});

module.exports = mongoose.models.User || mongoose.model('User', schema);
