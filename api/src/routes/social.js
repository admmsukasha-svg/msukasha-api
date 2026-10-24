const express = require('express');
const Favorite = require('../models/Favorite');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const SupportTicket = require('../models/SupportTicket');
const Referral = require('../models/Referral');
const Product = require('../models/Product');
const Ad = require('../models/Ad');
const BusinessProfile = require('../models/BusinessProfile');
const PageContent = require('../models/PageContent');
const Setting = require('../models/Setting');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, isObjectId, toPage } = require('../utils/helpers');

const router = express.Router();

/* ---------- Favorites ---------- */
const KINDS = ['product', 'supplier', 'c2c'];
router.get('/favorites', requireAuth, asyncHandler(async (req, res) => {
  const favs = await Favorite.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(300);
  const ids = (k) => favs.filter((f) => f.kind === k).map((f) => f.ref);
  const [products, suppliers, c2c] = await Promise.all([
    Product.find({ _id: { $in: ids('product') }, status: 'active' }).select('name slug price currency img images moq unit'),
    BusinessProfile.find({ _id: { $in: ids('supplier') } }).select('companyName slug country city logo businessType'),
    Ad.find({ _id: { $in: ids('c2c') }, status: 'approved' }).select('title price city img images condition')
  ]);
  res.json({ favorites: favs, products, suppliers, c2c });
}));
router.post('/favorites', requireAuth, asyncHandler(async (req, res) => {
  const { kind, ref } = req.body || {};
  if (!KINDS.includes(kind) || !isObjectId(String(ref))) throw new HttpError(400, 'Invalid favorite.');
  const Model = { product: Product, supplier: BusinessProfile, c2c: Ad }[kind];
  if (!(await Model.exists({ _id: ref }))) throw new HttpError(404, 'Item not found.');
  await Favorite.updateOne({ user: req.user._id, kind, ref }, { $setOnInsert: { user: req.user._id, kind, ref } }, { upsert: true });
  res.status(201).json({ message: 'Saved.' });
}));
router.delete('/favorites/:kind/:ref', requireAuth, asyncHandler(async (req, res) => {
  if (!KINDS.includes(req.params.kind) || !isObjectId(req.params.ref)) throw new HttpError(400, 'Invalid favorite.');
  await Favorite.deleteOne({ user: req.user._id, kind: req.params.kind, ref: req.params.ref });
  res.json({ message: 'Removed.' });
}));

/* ---------- Notifications ---------- */
router.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit } = toPage(req.query);
  const [notifications, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments({ user: req.user._id, readAt: { $exists: false } })
  ]);
  res.json({ notifications, unread });
}));
router.post('/notifications/read', requireAuth, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String).filter(isObjectId).slice(0, 100) : null;
  const q = { user: req.user._id, readAt: { $exists: false } };
  if (ids) q._id = { $in: ids };
  await Notification.updateMany(q, { readAt: new Date() });
  res.json({ message: 'Marked as read.' });
}));

/* ---------- Reports ---------- */
const REASONS = ['suspicious', 'counterfeit', 'prohibited_item', 'misleading', 'spam', 'harassment', 'other'];
router.post('/reports', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!['product', 'supplier', 'c2c', 'user', 'conversation'].includes(b.targetType)) throw new HttpError(400, 'Invalid report target.');
  if (!REASONS.includes(b.reason)) throw new HttpError(400, 'Choose a reason.');
  const targetId = cleanText(b.targetId, 60);
  if (!isObjectId(targetId)) throw new HttpError(400, 'Invalid report target.');
  try {
    const report = await Report.create({ reporter: req.user._id, targetType: b.targetType, targetId, reason: b.reason, details: cleanText(b.details, 2000) });
    res.status(201).json({ message: 'Thank you. Our team will review your report.', id: report.id });
  } catch (e) {
    if (e.code === 11000) throw new HttpError(409, 'You have already reported this item.');
    throw e;
  }
}));

/* ---------- Support tickets ---------- */
router.post('/support/tickets', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const subject = cleanText(b.subject, 200), text = cleanText(b.text, 3000);
  if (!subject || !text) throw new HttpError(400, 'Subject and message are required.');
  const category = ['account', 'listing', 'verification', 'rfq', 'report', 'other'].includes(b.category) ? b.category : 'other';
  const t = await SupportTicket.create({ user: req.user._id, subject, category, messages: [{ author: req.user._id, text }] });
  res.status(201).json({ ticket: t });
}));
router.get('/support/tickets', requireAuth, asyncHandler(async (req, res) => {
  res.json({ tickets: await SupportTicket.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(100) });
}));
router.post('/support/tickets/:id/reply', requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Ticket not found.');
  const t = await SupportTicket.findOne({ _id: req.params.id, user: req.user._id });
  if (!t) throw new HttpError(404, 'Ticket not found.');
  const text = cleanText(req.body && req.body.text, 3000);
  if (!text) throw new HttpError(400, 'Message cannot be empty.');
  t.messages.push({ author: req.user._id, text }); if (t.status !== 'open') t.status = 'open';
  await t.save();
  res.json({ ticket: t });
}));

/* ---------- Referrals (own) ---------- */
router.get('/referrals/me', requireAuth, asyncHandler(async (req, res) => {
  const rows = await Referral.find({ referrer: req.user._id }).sort({ createdAt: -1 }).limit(200);
  const reward = await Setting.findOne({ key: 'referral.program' }).lean();
  res.json({
    code: req.user.referralCode,
    shareLink: `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/join-as-supplier?ref=${req.user.referralCode}`,
    program: reward ? reward.value : { enabled: false, description: 'No referral reward is currently offered.' },
    referrals: rows.map((r) => ({ registeredAt: r.registeredAt, emailVerified: !!r.emailVerifiedAt, businessVerified: !!r.businessVerifiedAt, activated: !!r.activatedAt, eligible: r.eligible, rewardStatus: r.rewardStatus }))
  });
}));

/* ---------- Public policy / content pages ---------- */
router.get('/pages/:slug', asyncHandler(async (req, res) => {
  const page = await PageContent.findOne({ slug: String(req.params.slug).toLowerCase().slice(0, 80), published: true });
  if (!page) throw new HttpError(404, 'Page not found.');
  res.json({ page });
}));

module.exports = router;
