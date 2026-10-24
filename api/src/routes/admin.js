const express = require('express');
const BusinessAd = require('../models/BusinessAd');
const Ad = require('../models/Ad');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { PACKAGES } = require('../config/packages');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sanitizeAdInput } = require('../utils/adFields');
const {
  asyncHandler, HttpError, cleanText, escapeRegex, clampInt, isObjectId, parseDate
} = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

async function findAd(id) {
  if (!isObjectId(id)) throw new HttpError(404, 'Advertisement not found.');
  const ad = await BusinessAd.findById(id);
  if (!ad) throw new HttpError(404, 'Advertisement not found.');
  return ad;
}

/* ---------------- Business ads (admin_ads.html) ---------------- */

// GET /api/admin/business-ads?status=pending&paymentStatus=...&q=...
router.get('/business-ads', asyncHandler(async (req, res) => {
  const q = {};
  const now = new Date();
  const status = String(req.query.status || '');
  if (['pending', 'approved', 'rejected'].includes(status)) q.status = status;
  else if (status === 'expired') Object.assign(q, { status: 'approved', endDate: { $lt: now } });
  else if (status === 'scheduled') Object.assign(q, { status: 'approved', startDate: { $gt: now } });

  const pay = String(req.query.paymentStatus || '');
  if (['unpaid', 'pending_verification', 'paid', 'rejected'].includes(pay)) q.paymentStatus = pay;
  if (PACKAGES[String(req.query.package || '')]) q.package = String(req.query.package);
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
    q.$or = [{ title: rx }, { businessName: rx }, { email: rx }];
  }
  const ads = await BusinessAd.find(q).sort({ createdAt: -1 }).limit(500);
  res.json({ ads });
}));

// PATCH /api/admin/business-ads/:id/approve
router.patch('/business-ads/:id/approve', asyncHandler(async (req, res) => {
  const ad = await findAd(req.params.id);
  if (ad.status === 'approved') throw new HttpError(409, 'This advertisement is already approved.');

  const requirePayment = process.env.REQUIRE_PAYMENT_FOR_APPROVAL !== 'false';
  if (requirePayment && ad.paymentStatus === 'unpaid') {
    throw new HttpError(400, 'Payment has not been submitted for this advertisement yet.');
  }
  if (requirePayment && ad.paymentStatus === 'rejected') {
    throw new HttpError(400, 'The payment for this advertisement was rejected.');
  }

  const b = req.body || {};
  const start = b.startDate ? parseDate(b.startDate) : new Date();
  const duration = clampInt(b.duration, 1, 365, ad.duration);
  const end = b.endDate ? parseDate(b.endDate) : new Date(start.getTime() + duration * 86400000);
  if (end <= start) throw new HttpError(400, 'End date must be after the start date.');

  ad.set({
    status: 'approved', startDate: start, endDate: end, duration,
    priority: (PACKAGES[ad.package] || {}).priority || 1,
    approvedBy: req.user._id, approvedAt: new Date(), rejectionReason: ''
  });
  // Approving after a submitted payment means the admin verified it.
  if (ad.paymentStatus === 'pending_verification') ad.paymentStatus = 'paid';
  await ad.save();
  res.json({ message: 'Advertisement approved.', ad });
}));

// PATCH /api/admin/business-ads/:id/reject
router.patch('/business-ads/:id/reject', asyncHandler(async (req, res) => {
  const ad = await findAd(req.params.id);
  ad.status = 'rejected';
  ad.rejectionReason = cleanText(req.body && req.body.reason, 500);
  await ad.save();
  res.json({ message: 'Advertisement rejected.', ad });
}));

// PATCH /api/admin/business-ads/:id/payment   { status: "paid" | "rejected", note }
router.patch('/business-ads/:id/payment', asyncHandler(async (req, res) => {
  const ad = await findAd(req.params.id);
  const status = String(req.body && req.body.status || '');
  if (!['paid', 'rejected'].includes(status)) throw new HttpError(400, 'Status must be "paid" or "rejected".');
  ad.paymentStatus = status;
  if (req.body.note) ad.payment.note = cleanText(req.body.note, 500);
  await ad.save();
  res.json({ message: 'Payment status updated.', ad });
}));

// PUT /api/admin/business-ads/:id   (edit details / status / dates)
router.put('/business-ads/:id', asyncHandler(async (req, res) => {
  const ad = await findAd(req.params.id);
  const b = req.body || {};
  const update = sanitizeAdInput(b, { partial: true });

  if (b.status !== undefined) {
    if (!['pending', 'approved', 'rejected', 'expired'].includes(b.status)) throw new HttpError(400, 'Invalid status.');
    update.status = b.status;
  }
  if (b.paymentStatus !== undefined) {
    if (!['unpaid', 'pending_verification', 'paid', 'rejected'].includes(b.paymentStatus)) throw new HttpError(400, 'Invalid payment status.');
    update.paymentStatus = b.paymentStatus;
  }
  if (b.startDate !== undefined) update.startDate = parseDate(b.startDate);
  if (b.endDate !== undefined) update.endDate = parseDate(b.endDate);
  if (b.duration !== undefined) update.duration = clampInt(b.duration, 1, 365, ad.duration);
  if (b.amount !== undefined) {
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Invalid amount.');
    update.amount = amount;
  }
  if (update.package) update.priority = PACKAGES[update.package].priority;

  ad.set(update);
  await ad.save();
  res.json({ ad });
}));

/* ---------------- C2C classified ads ---------------- */

router.get('/ads', asyncHandler(async (req, res) => {
  const q = ['pending', 'approved', 'rejected'].includes(req.query.status) ? { status: req.query.status } : {};
  res.json({ ads: await Ad.find(q).sort({ createdAt: -1 }).limit(500) });
}));

['approve', 'reject'].forEach((action) => {
  router.patch(`/ads/:id/${action}`, asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(404, 'Ad not found.');
    const ad = await Ad.findById(req.params.id);
    if (!ad) throw new HttpError(404, 'Ad not found.');
    ad.status = action === 'approve' ? 'approved' : 'rejected';
    ad.rejectionReason = action === 'reject' ? cleanText(req.body && req.body.reason, 500) : '';
    await ad.save();
    res.json({ ad });
  }));
});

/* ---------------- Form submissions and users ---------------- */

router.get('/submissions', asyncHandler(async (req, res) => {
  const q = req.query.type ? { type: String(req.query.type) } : {};
  res.json({ submissions: await Submission.find(q).sort({ createdAt: -1 }).limit(500) });
}));

router.get('/users', asyncHandler(async (req, res) => {
  res.json({ users: await User.find().sort({ createdAt: -1 }).limit(500) });
}));

module.exports = router;
