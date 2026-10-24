const express = require('express');
const BusinessProfile = require('../models/BusinessProfile');
const Store = require('../models/Store');
const SupplierVerification = require('../models/SupplierVerification');
const Category = require('../models/Category');
const Product = require('../models/Product');
const User = require('../models/User');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const storage = require('../lib/storage');
const { audit } = require('../lib/audit');
const {
  asyncHandler, HttpError, cleanText, cleanUrl, cleanAsset, uniqueSlug, escapeRegex, toPage, isObjectId, isEmail
} = require('../utils/helpers');

const router = express.Router();

async function sellerContext(user, targetOwnerId) {
  const owner = targetOwnerId || user._id;
  const [profile, store, verification] = await Promise.all([
    BusinessProfile.findOne({ owner }), Store.findOne({ owner }), SupplierVerification.findOne({ owner })
  ]);
  return { profile, store, verification };
}

function summary(u, { profile, store, verification }) {
  return {
    profile, store, verification: verification ? verification.toJSON() : null,
    completion: profile ? profile.completion() : { percent: 0, missing: ['Company profile'] },
    levels: SupplierVerification.levelsFor(u, verification)
  };
}

// GET /api/business/me
router.get('/business/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(summary(req.user, await sellerContext(req.user)));
}));

function profileFields(b, partial) {
  const out = {};
  const types = BusinessProfile.BUSINESS_TYPES;
  if (b.businessType !== undefined || !partial) {
    if (!types.includes(b.businessType)) throw new HttpError(400, 'Choose a valid business type.');
    out.businessType = b.businessType;
  }
  if (b.companyName !== undefined || !partial) {
    out.companyName = cleanText(b.companyName, 160);
    if (out.companyName.length < 2) throw new HttpError(400, 'Company or business name is required.');
  }
  if (b.description !== undefined) out.description = cleanText(b.description, 3000);
  if (b.country !== undefined) out.country = cleanText(b.country, 2).toUpperCase();
  if (b.city !== undefined) out.city = cleanText(b.city, 80);
  if (b.address !== undefined) out.address = cleanText(b.address, 300);
  if (b.website !== undefined) out.website = cleanUrl(b.website);
  if (b.phone !== undefined) out.phone = cleanText(b.phone, 30);
  if (b.email !== undefined) {
    const e = cleanText(b.email, 254).toLowerCase();
    if (e && !isEmail(e)) throw new HttpError(400, 'Enter a valid business email.');
    out.email = e;
  }
  if (b.yearEstablished !== undefined && b.yearEstablished !== '') {
    const y = Number(b.yearEstablished);
    if (!Number.isInteger(y) || y < 1800 || y > new Date().getFullYear()) throw new HttpError(400, 'Enter a valid year.');
    out.yearEstablished = y;
  }
  if (b.registrationNumber !== undefined) out.registrationNumber = cleanText(b.registrationNumber, 60);
  if (b.taxId !== undefined) out.taxId = cleanText(b.taxId, 60);
  if (b.logo !== undefined) out.logo = cleanAsset(b.logo);
  if (b.photos !== undefined) {
    if (!Array.isArray(b.photos)) throw new HttpError(400, 'photos must be a list.');
    out.photos = b.photos.slice(0, 8).map(cleanAsset).filter(Boolean);
  }
  if (b.onboardingStep !== undefined) out.onboardingStep = Math.min(6, Math.max(1, parseInt(b.onboardingStep, 10) || 1));
  return out;
}

async function categoryIds(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'categories must be a list.');
  const ids = list.slice(0, 12).map(String).filter(isObjectId);
  const found = await Category.find({ _id: { $in: ids }, active: true }).select('_id').lean();
  return found.map((c) => c._id);
}

// PUT /api/business/profile  – create or update (upsert). A buyer who creates one becomes a seller.
router.put('/business/profile', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  let profile = await BusinessProfile.findOne({ owner: req.user._id });
  const fields = profileFields(b, !!profile);
  if (b.categories !== undefined) fields.categories = await categoryIds(b.categories);
  if (profile) {
    profile.set(fields);
  } else {
    profile = new BusinessProfile({ ...fields, owner: req.user._id, slug: await uniqueSlug(BusinessProfile, fields.companyName, 'slug') });
    if (!profile.country) profile.country = req.user.country || '';
  }
  await profile.save();
  if (req.user.role === 'buyer') { req.user.role = 'seller'; req.user.accountType = 'seller'; await req.user.save(); }
  await Store.updateOne({ owner: req.user._id }, { profile: profile._id });
  res.json(summary(req.user, await sellerContext(req.user)));
}));

// PUT /api/business/store  – create or update the digital store
router.put('/business/store', requireAuth, asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.findOne({ owner: req.user._id });
  if (!profile) throw new HttpError(400, 'Create your business profile first.');
  const b = req.body || {};
  let store = await Store.findOne({ owner: req.user._id });
  if (!store) store = new Store({ owner: req.user._id, profile: profile._id, slug: profile.slug });
  if (b.banner !== undefined) store.banner = cleanAsset(b.banner);
  if (b.intro !== undefined) store.intro = cleanText(b.intro, 2000);
  if (b.contactPreferences && typeof b.contactPreferences === 'object') {
    ['allowInquiries', 'allowRfq', 'showPhone'].forEach((k) => { if (typeof b.contactPreferences[k] === 'boolean') store.contactPreferences[k] = b.contactPreferences[k]; });
  }
  if (b.wholesale && typeof b.wholesale === 'object') {
    if (Array.isArray(b.wholesale.currencies)) store.wholesale.currencies = b.wholesale.currencies.filter((c) => ['USD', 'PKR'].includes(c));
    if (b.wholesale.shippingTerms !== undefined) store.wholesale.shippingTerms = cleanText(b.wholesale.shippingTerms, 500);
    if (b.wholesale.paymentTerms !== undefined) store.wholesale.paymentTerms = cleanText(b.wholesale.paymentTerms, 500);
  }
  await store.save();
  res.json(summary(req.user, await sellerContext(req.user)));
}));

// POST /api/business/store/publish  { publish: true|false }
router.post('/business/store/publish', requireAuth, asyncHandler(async (req, res) => {
  const { profile, store } = await sellerContext(req.user);
  if (!profile || !store) throw new HttpError(400, 'Create your profile and store first.');
  if (store.status === 'suspended') throw new HttpError(403, 'This store is suspended. Contact support.');
  const publish = !(req.body && req.body.publish === false);
  if (publish) {
    if (!req.user.emailVerified) throw new HttpError(403, 'Verify your email before publishing your store.');
    const c = profile.completion();
    if (c.percent < 50) throw new HttpError(400, `Complete more of your profile before publishing (${c.percent}% done). Missing: ${c.missing.join(', ')}.`);
    store.status = 'published'; store.publishedAt = store.publishedAt || new Date();
  } else store.status = 'draft';
  await store.save();
  res.json(summary(req.user, await sellerContext(req.user)));
}));

// GET /api/uploads/sign?kind=image|document
router.get('/uploads/sign', requireAuth, asyncHandler(async (req, res) => {
  const kind = req.query.kind === 'document' ? 'document' : 'image';
  const sig = storage.signUpload(kind, String(req.user._id));
  if (!sig) return res.status(501).json({ error: 'File uploads are not configured yet (Cloudinary credentials pending).', code: 'STORAGE_NOT_CONFIGURED' });
  res.json(sig);
}));

// POST /api/business/verification/documents { kind, publicId, format }  – private document submission
router.post('/business/verification/documents', requireAuth, asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.findOne({ owner: req.user._id });
  if (!profile) throw new HttpError(400, 'Create your business profile first.');
  const b = req.body || {};
  const kinds = ['business_registration', 'tax_certificate', 'identity_document', 'trade_license', 'other'];
  if (!kinds.includes(b.kind)) throw new HttpError(400, 'Choose a valid document type.');
  const publicId = cleanText(b.publicId, 300);
  // The document must live in this user's private folder (prevents referencing someone else's file).
  if (!publicId.startsWith(`msukasha/private/${req.user._id}/`)) throw new HttpError(400, 'Invalid document reference.');
  let v = await SupplierVerification.findOne({ owner: req.user._id });
  if (!v) v = new SupplierVerification({ owner: req.user._id, profile: profile._id });
  if (v.documents.length >= 10) throw new HttpError(400, 'Too many documents.');
  v.documents.push({ kind: b.kind, publicId, format: cleanText(b.format, 10) });
  v.documentsStatus = 'submitted'; v.submittedAt = new Date();
  await v.save();
  await audit(req, 'verification.submit', { type: 'verification', id: v._id });
  // Never return storage identifiers back to the browser.
  res.status(201).json({ message: 'Document submitted for review.', documentsStatus: v.documentsStatus, documentCount: v.documents.length });
}));

/* ---------------- Public supplier directory ---------------- */

function publicProfile(profile, store, levels, showPhone) {
  const p = profile.toJSON();
  BusinessProfile.PRIVATE_FIELDS.forEach((k) => delete p[k]);
  delete p.taxId;
  return {
    ...p,
    phone: showPhone && store.contactPreferences.showPhone ? profile.phone : undefined,
    store: { slug: store.slug, banner: store.banner, intro: store.intro, wholesale: store.wholesale, contactPreferences: { allowInquiries: store.contactPreferences.allowInquiries, allowRfq: store.contactPreferences.allowRfq } },
    verificationLevels: levels, ownerId: String(profile.owner)
  };
}

// GET /api/suppliers?q=&country=&city=&type=&category=&verified=documents&page=
router.get('/suppliers', asyncHandler(async (req, res) => {
  const f = req.query;
  const { page, limit } = toPage(f);
  const stores = await Store.find({ status: 'published' }).select('owner').lean();
  const q = { owner: { $in: stores.map((s) => s.owner) } };
  if (f.country) q.country = String(f.country).toUpperCase().slice(0, 2);
  if (f.city) q.city = new RegExp(`^${escapeRegex(String(f.city).slice(0, 80))}$`, 'i');
  if (BusinessProfile.BUSINESS_TYPES.includes(f.type)) q.businessType = f.type;
  if (f.category && isObjectId(String(f.category))) q.categories = String(f.category);
  if (f.verified === 'documents') {
    const ok = await SupplierVerification.find({ documentsStatus: 'approved' }).select('owner').lean();
    q.owner = { $in: ok.map((v) => v.owner).filter((o) => stores.some((s) => String(s.owner) === String(o))) };
  }
  if (f.q) q.$text = { $search: String(f.q).slice(0, 80) };
  const sort = f.q ? { score: { $meta: 'textScore' } } : { createdAt: -1 };
  const proj = f.q ? { score: { $meta: 'textScore' } } : {};
  const [rows, total] = await Promise.all([
    BusinessProfile.find(q, proj).sort(sort).skip((page - 1) * limit).limit(limit),
    BusinessProfile.countDocuments(q)
  ]);
  const owners = rows.map((r) => r.owner);
  const [ss, vs, us] = await Promise.all([
    Store.find({ owner: { $in: owners } }), SupplierVerification.find({ owner: { $in: owners } }), User.find({ _id: { $in: owners } })
  ]);
  const by = (arr, k) => Object.fromEntries(arr.map((x) => [String(x[k]), x]));
  const sm = by(ss, 'owner'), vm = by(vs, 'owner'), um = by(us, '_id');
  const suppliers = rows.map((r) => publicProfile(r, sm[String(r.owner)], SupplierVerification.levelsFor(um[String(r.owner)], vm[String(r.owner)]), false));
  res.json({ suppliers, total, page, pages: Math.ceil(total / limit) });
}));

// GET /api/suppliers/:slug
router.get('/suppliers/:slug', asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.findOne({ slug: String(req.params.slug).toLowerCase().slice(0, 180) });
  const store = profile && (await Store.findOne({ owner: profile.owner, status: 'published' }));
  const owner = profile && (await User.findById(profile.owner));
  if (!profile || !store || !owner || !owner.isActive || owner.deletedAt) throw new HttpError(404, 'Supplier not found.');
  const v = await SupplierVerification.findOne({ owner: profile.owner });
  const productCount = await Product.countDocuments({ seller: profile.owner, status: 'active' });
  res.json({ supplier: publicProfile(profile, store, SupplierVerification.levelsFor(owner, v), true), productCount });
}));

// POST /api/business/assist-consent { allow: boolean }  – lets support staff help with onboarding for 7 days
router.post('/business/assist-consent', requireAuth, asyncHandler(async (req, res) => {
  const allow = !!(req.body && req.body.allow);
  req.user.assistConsentUntil = allow ? new Date(Date.now() + 7 * 86400000) : undefined;
  await req.user.save();
  await audit(req, allow ? 'onboarding.consent.granted' : 'onboarding.consent.revoked', { type: 'user', id: req.user._id });
  res.json({ allowed: allow, until: req.user.assistConsentUntil || null });
}));

module.exports = router;
module.exports.profileFields = profileFields;
module.exports.categoryIds = categoryIds;
module.exports.sellerContext = sellerContext;
module.exports.summary = summary;
