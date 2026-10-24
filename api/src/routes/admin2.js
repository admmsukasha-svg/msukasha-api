const express = require('express');
const User = require('../models/User');
const Product = require('../models/Product');
const Store = require('../models/Store');
const BusinessProfile = require('../models/BusinessProfile');
const SupplierVerification = require('../models/SupplierVerification');
const Category = require('../models/Category');
const Report = require('../models/Report');
const ModerationAction = require('../models/ModerationAction');
const Ad = require('../models/Ad');
const Rfq = require('../models/Rfq');
const Quotation = require('../models/Quotation');
const Conversation = require('../models/Conversation');
const Referral = require('../models/Referral');
const AcquisitionCampaign = require('../models/AcquisitionCampaign');
const SupportTicket = require('../models/SupportTicket');
const AuditLog = require('../models/AuditLog');
const EmailTemplate = require('../models/EmailTemplate');
const PageContent = require('../models/PageContent');
const Setting = require('../models/Setting');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePermission, can, rolesOf, STAFF_ROLES } = require('../lib/permissions');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { sendTemplate, APP_URL, DEFAULT_TEMPLATES } = require('../lib/mailer');
const storage = require('../lib/storage');
const business = require('./business');
const { asyncHandler, HttpError, cleanText, escapeRegex, isObjectId, toPage, slugify, uniqueSlug } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));   // every route below additionally checks a specific permission

const idOr404 = (id, what = 'Item') => { if (!isObjectId(String(id))) throw new HttpError(404, `${what} not found.`); return String(id); };
const reasonRequired = (v) => { const r = cleanText(v, 1000); if (r.length < 3) throw new HttpError(400, 'A reason is required.'); return r; };

/* ---------- Overview & analytics ---------- */
router.get('/me', (req, res) => res.json({ roles: rolesOf(req.user) }));

router.get('/overview', asyncHandler(async (req, res) => {
  const [pendingProducts, pendingVerifications, openReports, pendingC2c, openTickets] = await Promise.all([
    Product.countDocuments({ status: 'pending_review' }), SupplierVerification.countDocuments({ documentsStatus: 'submitted' }),
    Report.countDocuments({ status: 'open' }), Ad.countDocuments({ status: 'pending' }), SupportTicket.countDocuments({ status: 'open' })
  ]);
  res.json({ pendingProducts, pendingVerifications, openReports, pendingC2c, openTickets });
}));

// Only recorded events are counted. Registered users, verified businesses and activated suppliers are distinct numbers.
router.get('/analytics', requirePermission('analytics.read'), asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 86400000);
  const [registrations, sellers, verifiedBusinesses, publishedStores, activatedSuppliers, publishedProducts, rfqs, quotations, conversations, referralTotal, referralEligible, referralActivated] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: since } }), User.countDocuments({ role: 'seller', createdAt: { $gte: since } }),
    SupplierVerification.countDocuments({ documentsStatus: 'approved' }), Store.countDocuments({ status: 'published' }),
    Product.distinct('seller', { status: 'active' }).then((a) => a.length), Product.countDocuments({ status: 'active' }),
    Rfq.countDocuments({ createdAt: { $gte: since } }), Quotation.countDocuments({ createdAt: { $gte: since } }),
    Conversation.countDocuments({ createdAt: { $gte: since } }),
    Referral.countDocuments({ createdAt: { $gte: since } }), Referral.countDocuments({ createdAt: { $gte: since }, eligible: true }), Referral.countDocuments({ activatedAt: { $gte: since } })
  ]);
  const rfqsWithQuote = await Rfq.countDocuments({ createdAt: { $gte: since }, quotationCount: { $gt: 0 } });
  const bySource = await User.aggregate([
    { $match: { createdAt: { $gte: since }, acquisitionSource: { $ne: '' } } },
    { $group: { _id: '$acquisitionSource', registrations: { $sum: 1 } } }, { $sort: { registrations: -1 } }, { $limit: 50 }
  ]);
  res.json({
    windowDays: days,
    vendors: { newRegistrations: registrations, newSellerAccounts: sellers, verifiedBusinessesTotal: verifiedBusinesses, publishedStoresTotal: publishedStores, activatedSuppliersTotal: activatedSuppliers, publishedProductsTotal: publishedProducts },
    engagement: { rfqs, quotations, conversationsStarted: conversations, rfqResponseRate: rfqs ? Math.round((rfqsWithQuote / rfqs) * 100) : null },
    referrals: { total: referralTotal, eligible: referralEligible, activated: referralActivated },
    acquisitionBySource: bySource.map((s) => ({ source: s._id, registrations: s.registrations }))
  });
}));

/* ---------- Users ---------- */
router.get('/users', requirePermission('users.read'), asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.role) q.role = String(req.query.role);
  if (req.query.q) { const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i'); q.$or = [{ name: rx }, { email: rx }, { companyName: rx }]; }
  const { page, limit } = toPage(req.query);
  const [users, total] = await Promise.all([User.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(q)]);
  res.json({ users, total, page, pages: Math.ceil(total / limit) });
}));
router.patch('/users/:id/status', requirePermission('users.manage'), asyncHandler(async (req, res) => {
  const u = await User.findById(idOr404(req.params.id, 'User'));
  if (!u) throw new HttpError(404, 'User not found.');
  if (String(u._id) === String(req.user._id)) throw new HttpError(400, 'You cannot change your own status.');
  u.isActive = !!(req.body && req.body.isActive);
  await u.save();
  await audit(req, u.isActive ? 'user.reactivate' : 'user.suspend', { type: 'user', id: u._id }, { data: { reason: cleanText(req.body && req.body.reason, 500) } });
  res.json({ user: u });
}));
router.put('/users/:id/staff-roles', requirePermission('staff.manage'), asyncHandler(async (req, res) => {
  const u = await User.findById(idOr404(req.params.id, 'User'));
  if (!u) throw new HttpError(404, 'User not found.');
  const roles = (Array.isArray(req.body && req.body.staffRoles) ? req.body.staffRoles : []).filter((r) => STAFF_ROLES.includes(r));
  if (String(u._id) === String(req.user._id) && !roles.includes('super_admin')) throw new HttpError(400, 'You cannot remove your own super admin role.');
  u.staffRoles = roles; u.role = roles.length ? 'admin' : (u.role === 'admin' ? 'buyer' : u.role);
  await u.save();
  await audit(req, 'staff.roles.update', { type: 'user', id: u._id }, { data: { roles } });
  res.json({ user: u });
}));

/* ---------- Product moderation ---------- */
router.get('/products', requirePermission('products.review'), asyncHandler(async (req, res) => {
  const status = Product.STATUSES.includes(req.query.status) ? req.query.status : 'pending_review';
  const { page, limit } = toPage(req.query);
  const [products, total] = await Promise.all([
    Product.find({ status }).sort({ updatedAt: 1 }).skip((page - 1) * limit).limit(limit).populate('seller', 'name email companyName emailVerified').populate('category', 'name'),
    Product.countDocuments({ status })
  ]);
  res.json({ products, total, page, pages: Math.ceil(total / limit) });
}));

async function decideProduct(req, res, action, toStatus) {
  const p = await Product.findById(idOr404(req.params.id, 'Product'));
  if (!p) throw new HttpError(404, 'Product not found.');
  const needsReason = action !== 'approve';
  const reason = needsReason ? reasonRequired(req.body && req.body.reason) : cleanText(req.body && req.body.reason, 1000);
  if (action === 'approve' && p.status !== 'pending_review') throw new HttpError(400, 'Only products pending review can be approved.');
  p.status = toStatus; p.reviewedBy = req.user._id; p.reviewedAt = new Date();
  p.rejectionReason = needsReason ? reason : '';
  if (action === 'approve') p.publishedAt = p.publishedAt || new Date();
  await p.save();
  await ModerationAction.create({ moderator: req.user._id, targetType: 'product', targetId: String(p._id), action, reason });
  await audit(req, `product.${action}`, { type: 'product', id: p._id });
  const seller = await User.findById(p.seller);
  if (seller) {
    const decision = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended';
    await notify(seller._id, 'product', `Product ${decision}`, p.name, '/dashboard/products');
    if (seller.notificationPrefs.email) sendTemplate('product_decision', seller.email, { name: seller.name, product: p.name, decision, reason: reason ? `Reason: ${reason}` : '', link: `${APP_URL()}/dashboard/products` });
    if (action === 'approve') {
      // Referral activation = the referred supplier's first approved & published product.
      const ref = await Referral.findOne({ referred: seller._id, activatedAt: { $exists: false } });
      if (ref) { ref.activatedAt = new Date(); if (ref.eligible && ref.emailVerifiedAt) ref.rewardStatus = 'pending'; await ref.save(); }
    }
  }
  res.json({ product: p });
}
router.post('/products/:id/approve', requirePermission('products.review'), asyncHandler((req, res) => decideProduct(req, res, 'approve', 'active')));
router.post('/products/:id/reject', requirePermission('products.review'), asyncHandler((req, res) => decideProduct(req, res, 'reject', 'rejected')));
router.post('/products/:id/suspend', requirePermission('products.review'), asyncHandler((req, res) => decideProduct(req, res, 'suspend', 'paused')));

/* ---------- Supplier verification ---------- */
router.get('/verifications', requirePermission('verification.review'), asyncHandler(async (req, res) => {
  const status = ['submitted', 'approved', 'rejected', 'resubmit'].includes(req.query.status) ? req.query.status : 'submitted';
  const rows = await SupplierVerification.find({ documentsStatus: status }).sort({ submittedAt: 1 }).limit(200).populate('profile', 'companyName country city businessType registrationNumber').populate('owner', 'name email emailVerified phoneVerified');
  // document storage ids are not returned here; use the signed-URL endpoint (which is audited)
  res.json({ verifications: rows.map((v) => ({ ...v.toJSON(), documents: v.documents.map((d) => ({ id: String(d._id), kind: d.kind, uploadedAt: d.uploadedAt })) })) });
}));
router.get('/verifications/:id/documents/:docId/url', requirePermission('verification.review'), asyncHandler(async (req, res) => {
  const v = await SupplierVerification.findById(idOr404(req.params.id, 'Verification'));
  const d = v && v.documents.id(req.params.docId);
  if (!d) throw new HttpError(404, 'Document not found.');
  const url = storage.signedPrivateUrl(d.publicId, d.format, 300);
  if (!url) throw new HttpError(501, 'File storage is not configured yet.');
  await audit(req, 'verification.document.view', { type: 'verification', id: v._id }, { data: { docId: req.params.docId } });
  res.json({ url, expiresInSeconds: 300 });
}));
router.post('/verifications/:id/decision', requirePermission('verification.review'), asyncHandler(async (req, res) => {
  const v = await SupplierVerification.findById(idOr404(req.params.id, 'Verification'));
  if (!v) throw new HttpError(404, 'Verification not found.');
  const { level = 'business_documents', decision } = req.body || {};
  if (!['business_documents', 'additional'].includes(level)) throw new HttpError(400, 'Invalid level.');
  if (!['approved', 'rejected', 'resubmit'].includes(decision)) throw new HttpError(400, 'Invalid decision.');
  const reason = decision === 'approved' ? cleanText(req.body.reason, 1000) : reasonRequired(req.body.reason);
  if (level === 'business_documents') {
    if (v.documentsStatus !== 'submitted') throw new HttpError(400, 'There is no submission waiting for review.');
    v.documentsStatus = decision;
  } else {
    if (decision !== 'approved') throw new HttpError(400, 'Additional verification can only be granted after a real review.');
    if (reason.length < 10) throw new HttpError(400, 'Describe the review that was carried out.');
    v.additionalStatus = 'approved'; v.additionalNote = reason;
  }
  v.decisions.push({ reviewer: req.user._id, level, decision, reason });
  await v.save();
  await audit(req, `verification.${decision}`, { type: 'verification', id: v._id }, { data: { level } });
  if (level === 'business_documents' && decision === 'approved') await Referral.updateOne({ referred: v.owner, businessVerifiedAt: { $exists: false } }, { businessVerifiedAt: new Date() });
  await notify(v.owner, 'verification', `Verification ${decision}`, reason, '/dashboard/verification');
  res.json({ verification: v });
}));

/* ---------- Stores ---------- */
router.get('/stores', requirePermission('stores.manage'), asyncHandler(async (req, res) => {
  const q = ['draft', 'published', 'suspended'].includes(req.query.status) ? { status: req.query.status } : {};
  if (req.query.q) { const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i'); const ps = await BusinessProfile.find({ companyName: rx }).select('_id').limit(200); q.profile = { $in: ps.map((p) => p._id) }; }
  const { page, limit } = toPage(req.query);
  const [stores, total] = await Promise.all([Store.find(q).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('profile', 'companyName country city'), Store.countDocuments(q)]);
  res.json({ stores, total, page, pages: Math.ceil(total / limit) });
}));
router.patch('/stores/:id/status', requirePermission('stores.manage'), asyncHandler(async (req, res) => {
  const s = await Store.findById(idOr404(req.params.id, 'Store'));
  if (!s) throw new HttpError(404, 'Store not found.');
  const status = req.body && req.body.status;
  if (!['published', 'suspended', 'draft'].includes(status)) throw new HttpError(400, 'Invalid status.');
  const reason = status === 'suspended' ? reasonRequired(req.body.reason) : '';
  s.status = status; await s.save();
  await ModerationAction.create({ moderator: req.user._id, targetType: 'store', targetId: String(s._id), action: status === 'suspended' ? 'suspend' : 'restore', reason });
  await audit(req, `store.${status}`, { type: 'store', id: s._id });
  res.json({ store: s });
}));

/* ---------- Categories ---------- */
router.get('/categories', requirePermission('categories.read'), asyncHandler(async (req, res) => res.json({ categories: await Category.find().sort({ order: 1, name: 1 }) })));
router.post('/categories', requirePermission('categories.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = cleanText(b.name, 100);
  if (name.length < 2) throw new HttpError(400, 'Name is required.');
  let parent = null;
  if (b.parent) { if (!isObjectId(String(b.parent)) || !(await Category.exists({ _id: b.parent }))) throw new HttpError(400, 'Invalid parent.'); parent = b.parent; }
  const c = await Category.create({ name, slug: await uniqueSlug(Category, name), parent, description: cleanText(b.description, 500), icon: cleanText(b.icon, 60), order: Number(b.order) || 0, restricted: !!b.restricted });
  await audit(req, 'category.create', { type: 'category', id: c._id });
  res.status(201).json({ category: c });
}));
router.put('/categories/:id', requirePermission('categories.manage'), asyncHandler(async (req, res) => {
  const c = await Category.findById(idOr404(req.params.id, 'Category'));
  if (!c) throw new HttpError(404, 'Category not found.');
  const b = req.body || {};
  if (b.name !== undefined) c.name = cleanText(b.name, 100) || c.name;
  if (b.description !== undefined) c.description = cleanText(b.description, 500);
  if (b.icon !== undefined) c.icon = cleanText(b.icon, 60);
  if (b.order !== undefined) c.order = Number(b.order) || 0;
  if (b.active !== undefined) c.active = !!b.active;
  if (b.restricted !== undefined) c.restricted = !!b.restricted;
  await c.save();
  await audit(req, 'category.update', { type: 'category', id: c._id });
  res.json({ category: c });
}));
router.delete('/categories/:id', requirePermission('categories.manage'), asyncHandler(async (req, res) => {
  const id = idOr404(req.params.id, 'Category');
  if ((await Category.exists({ parent: id })) || (await Product.exists({ $or: [{ category: id }, { subcategory: id }] }))) throw new HttpError(409, 'This category is in use. Deactivate it instead.');
  await Category.deleteOne({ _id: id });
  await audit(req, 'category.delete', { type: 'category', id });
  res.json({ message: 'Category deleted.' });
}));

/* ---------- C2C moderation ---------- */
router.get('/c2c', requirePermission('c2c.moderate'), asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'removed'].includes(req.query.status) ? req.query.status : 'pending';
  res.json({ listings: await Ad.find({ status }).sort({ createdAt: 1 }).limit(200).populate('user', 'name email') });
}));
router.post('/c2c/:id/:action(approve|reject|remove)', requirePermission('c2c.moderate'), asyncHandler(async (req, res) => {
  const ad = await Ad.findById(idOr404(req.params.id, 'Listing'));
  if (!ad) throw new HttpError(404, 'Listing not found.');
  const action = req.params.action;
  const reason = action === 'approve' ? '' : reasonRequired(req.body && req.body.reason);
  ad.status = { approve: 'approved', reject: 'rejected', remove: 'removed' }[action]; ad.rejectionReason = reason;
  if (action === 'approve' && (!ad.expiresAt || ad.expiresAt < new Date())) ad.expiresAt = new Date(Date.now() + 30 * 86400000);
  await ad.save();
  await ModerationAction.create({ moderator: req.user._id, targetType: 'c2c', targetId: String(ad._id), action, reason });
  if (ad.user) await notify(ad.user, 'c2c', `Listing ${ad.status}`, ad.title, '/dashboard/c2c');
  res.json({ listing: ad });
}));

/* ---------- Reports ---------- */
router.get('/reports', requirePermission('reports.manage'), asyncHandler(async (req, res) => {
  const status = ['open', 'reviewing', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const { page, limit } = toPage(req.query);
  const [reports, total] = await Promise.all([Report.find({ status }).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).populate('reporter', 'name'), Report.countDocuments({ status })]);
  res.json({ reports, total, page, pages: Math.ceil(total / limit) });
}));
router.patch('/reports/:id', requirePermission('reports.manage'), asyncHandler(async (req, res) => {
  const r = await Report.findById(idOr404(req.params.id, 'Report'));
  if (!r) throw new HttpError(404, 'Report not found.');
  const status = req.body && req.body.status;
  if (!['reviewing', 'actioned', 'dismissed'].includes(status)) throw new HttpError(400, 'Invalid status.');
  r.status = status; r.handledBy = req.user._id; r.resolution = cleanText(req.body.resolution, 1000);
  await r.save();
  await audit(req, `report.${status}`, { type: 'report', id: r._id });
  res.json({ report: r });
}));

/* ---------- RFQ oversight ---------- */
router.get('/rfqs', requirePermission('rfq.read'), asyncHandler(async (req, res) => {
  const { page, limit } = toPage(req.query);
  const [rfqs, total] = await Promise.all([Rfq.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Rfq.countDocuments()]);
  res.json({ rfqs, total, page, pages: Math.ceil(total / limit) });
}));

/* ---------- Growth: campaigns, referral programme ---------- */
router.get('/campaigns', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const campaigns = await AcquisitionCampaign.find().sort({ createdAt: -1 }).limit(200);
  const counts = await User.aggregate([{ $match: { acquisitionSource: { $ne: '' } } }, { $group: { _id: '$acquisitionSource', registrations: { $sum: 1 } } }]);
  const by = Object.fromEntries(counts.map((c) => [c._id, c.registrations]));
  res.json({ campaigns: campaigns.map((c) => ({ ...c.toJSON(), registrations: by[c.source] || 0 })) });
}));
router.post('/campaigns', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const source = slugify(b.source || b.name);
  const c = await AcquisitionCampaign.create({ name: cleanText(b.name, 160), source, channel: ['email', 'whatsapp', 'event', 'partner', 'social', 'referral', 'other'].includes(b.channel) ? b.channel : 'other', notes: cleanText(b.notes, 2000), createdBy: req.user._id });
  res.status(201).json({ campaign: c, trackingLink: `${APP_URL()}/join-as-supplier?src=${source}` });
}));
router.post('/campaigns/:id/invitations', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const c = await AcquisitionCampaign.findById(idOr404(req.params.id, 'Campaign'));
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const b = req.body || {};
  const consentBasis = cleanText(b.consentBasis, 200);
  if (consentBasis.length < 5) throw new HttpError(400, 'Record how consent or a lawful basis for contacting this business was obtained.');
  if (c.invitations.length >= 5000) throw new HttpError(400, 'Campaign is full.');
  c.invitations.push({ contactName: cleanText(b.contactName, 120), contactEmail: cleanText(b.contactEmail, 254).toLowerCase(), consentBasis });
  await c.save();
  res.status(201).json({ campaign: c });
}));
router.patch('/campaigns/:id/invitations/:invId', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const c = await AcquisitionCampaign.findById(idOr404(req.params.id, 'Campaign'));
  const inv = c && c.invitations.id(req.params.invId);
  if (!inv) throw new HttpError(404, 'Invitation not found.');
  if (!['invited', 'registered', 'activated', 'verified', 'retained', 'declined', 'unsubscribed'].includes(req.body && req.body.status)) throw new HttpError(400, 'Invalid status.');
  inv.status = req.body.status; await c.save();
  res.json({ campaign: c });
}));
router.get('/referrals', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const { page, limit } = toPage(req.query);
  const rows = await Referral.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('referrer', 'name email').populate('referred', 'name email');
  res.json({ referrals: rows });
}));
router.patch('/referrals/:id', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const r = await Referral.findById(idOr404(req.params.id, 'Referral'));
  if (!r) throw new HttpError(404, 'Referral not found.');
  const s = req.body && req.body.rewardStatus;
  if (!['granted', 'denied'].includes(s)) throw new HttpError(400, 'Invalid status.');
  if (s === 'granted' && (!r.eligible || !r.activatedAt)) throw new HttpError(400, 'Only eligible, activated referrals can be rewarded.');
  r.rewardStatus = s; await r.save();
  await audit(req, `referral.${s}`, { type: 'referral', id: r._id });
  res.json({ referral: r });
}));
router.get('/settings/referral', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const s = await Setting.findOne({ key: 'referral.program' }).lean();
  res.json({ program: s ? s.value : { enabled: false, description: '' } });
}));
router.put('/settings/referral', requirePermission('growth.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const value = { enabled: !!b.enabled, description: cleanText(b.description, 500), rewardType: ['none', 'feature', 'credit', 'cash'].includes(b.rewardType) ? b.rewardType : 'none' };
  await Setting.updateOne({ key: 'referral.program' }, { value }, { upsert: true });
  await audit(req, 'settings.referral', { type: 'setting', id: 'referral.program' }, { data: value });
  res.json({ program: value });
}));

/* ---------- Support tickets ---------- */
router.get('/tickets', requirePermission('tickets.manage'), asyncHandler(async (req, res) => {
  const status = ['open', 'pending', 'resolved', 'closed'].includes(req.query.status) ? req.query.status : 'open';
  res.json({ tickets: await SupportTicket.find({ status }).sort({ updatedAt: 1 }).limit(200).populate('user', 'name email') });
}));
router.post('/tickets/:id/reply', requirePermission('tickets.manage'), asyncHandler(async (req, res) => {
  const t = await SupportTicket.findById(idOr404(req.params.id, 'Ticket')).populate('user', 'name email notificationPrefs');
  if (!t) throw new HttpError(404, 'Ticket not found.');
  const text = cleanText(req.body && req.body.text, 3000);
  if (!text) throw new HttpError(400, 'Message cannot be empty.');
  t.messages.push({ author: req.user._id, staff: true, text });
  if (['open', 'pending', 'resolved', 'closed'].includes(req.body.status)) t.status = req.body.status; else t.status = 'pending';
  if (!t.assignedTo) t.assignedTo = req.user._id;
  await t.save();
  await notify(t.user._id, 'support', 'Update on your support request', t.subject, '/dashboard/support');
  if (t.user.notificationPrefs.email) sendTemplate('ticket_update', t.user.email, { name: t.user.name, subject: t.subject, link: `${APP_URL()}/dashboard/support` });
  res.json({ ticket: t });
}));

/* ---------- Assisted onboarding (requires the supplier's consent; always audited) ---------- */
router.put('/onboarding/:userId/profile', requirePermission('onboarding.assist'), asyncHandler(async (req, res) => {
  const target = await User.findById(idOr404(req.params.userId, 'User'));
  if (!target) throw new HttpError(404, 'User not found.');
  if (!target.assistConsentUntil || target.assistConsentUntil < new Date()) throw new HttpError(403, 'This supplier has not given permission for assisted onboarding.');
  const b = req.body || {};
  let profile = await BusinessProfile.findOne({ owner: target._id });
  const fields = business.profileFields(b, !!profile);
  if (b.categories !== undefined) fields.categories = await business.categoryIds(b.categories);
  if (profile) profile.set(fields);
  else profile = new BusinessProfile({ ...fields, owner: target._id, slug: await uniqueSlug(BusinessProfile, fields.companyName) });
  await profile.save();
  await audit(req, 'onboarding.assist.profile', { type: 'profile', id: profile._id }, { onBehalfOf: target._id, data: { fields: Object.keys(fields) } });
  res.json({ profile });
}));

/* ---------- Content, email templates ---------- */
router.get('/pages', requirePermission('content.manage'), asyncHandler(async (req, res) => res.json({ pages: await PageContent.find().sort({ slug: 1 }) })));
router.put('/pages/:slug', requirePermission('content.manage'), asyncHandler(async (req, res) => {
  const slug = slugify(req.params.slug);
  const b = req.body || {};
  const page = await PageContent.findOneAndUpdate({ slug }, { slug, title: cleanText(b.title, 160) || slug, body: String(b.body || '').slice(0, 60000), published: b.published !== false, updatedBy: req.user._id }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(req, 'page.update', { type: 'page', id: slug });
  res.json({ page });
}));
router.get('/email-templates', requirePermission('content.manage'), asyncHandler(async (req, res) => {
  const custom = Object.fromEntries((await EmailTemplate.find()).map((t) => [t.key, t]));
  res.json({ templates: Object.entries(DEFAULT_TEMPLATES).map(([key, d]) => ({ key, subject: custom[key] ? custom[key].subject : d.subject, body: custom[key] ? custom[key].body : d.body, enabled: custom[key] ? custom[key].enabled : true, customized: !!custom[key] })) });
}));
router.put('/email-templates/:key', requirePermission('content.manage'), asyncHandler(async (req, res) => {
  if (!DEFAULT_TEMPLATES[req.params.key]) throw new HttpError(404, 'Unknown template.');
  const b = req.body || {};
  const t = await EmailTemplate.findOneAndUpdate({ key: req.params.key }, { key: req.params.key, subject: cleanText(b.subject, 200), body: String(b.body || '').slice(0, 5000), enabled: b.enabled !== false }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(req, 'emailtemplate.update', { type: 'emailtemplate', id: req.params.key });
  res.json({ template: t });
}));

/* ---------- Audit log & exports ---------- */
router.get('/audit', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.action) q.action = new RegExp(`^${escapeRegex(String(req.query.action).slice(0, 60))}`);
  const { page, limit } = toPage(req.query);
  const [logs, total] = await Promise.all([AuditLog.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name email'), AuditLog.countDocuments(q)]);
  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
}));

const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
router.get('/export/vendors.csv', requirePermission('export.read'), asyncHandler(async (req, res) => {
  const rows = await BusinessProfile.find().sort({ createdAt: -1 }).limit(20000).populate('owner', 'emailVerified createdAt referralCode acquisitionSource');
  const head = ['company', 'type', 'country', 'city', 'emailVerified', 'registeredAt', 'source'];
  const body = rows.map((p) => [p.companyName, p.businessType, p.country, p.city, p.owner && p.owner.emailVerified, p.owner && p.owner.createdAt && p.owner.createdAt.toISOString(), p.owner && p.owner.acquisitionSource].map(csvCell).join(','));
  await audit(req, 'export.vendors', {}, { data: { rows: rows.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="vendors.csv"');
  res.send([head.join(','), ...body].join('\n'));
}));

module.exports = router;
