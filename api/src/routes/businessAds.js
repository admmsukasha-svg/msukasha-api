const express = require('express');
const BusinessAd = require('../models/BusinessAd');
const { PACKAGES } = require('../config/packages');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { sanitizeAdInput } = require('../utils/adFields');
const { asyncHandler, HttpError, cleanText, isObjectId } = require('../utils/helpers');

const router = express.Router();

// Fields visitors may see. Contact details and payment data are never public.
const PUBLIC_FIELDS = 'title description targetUrl imageUrl businessName package startDate endDate priority';

function liveQuery(extra = {}) {
  const now = new Date();
  return { status: 'approved', startDate: { $lte: now }, endDate: { $gte: now }, ...extra };
}

const sameOwner = (ad, user) =>
  !!user && ((ad.user && String(ad.user) === String(user._id)) || ad.email === user.email);

async function loadOwned(req) {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Advertisement not found.');
  const ad = await BusinessAd.findById(req.params.id);
  if (!ad) throw new HttpError(404, 'Advertisement not found.');
  if (!sameOwner(ad, req.user) && req.user.role !== 'admin') {
    throw new HttpError(403, 'This is not your advertisement.');
  }
  return ad;
}

// POST /api/business-ads   (advertise.html; logged-in or guest)
router.post('/', optionalAuth, asyncHandler(async (req, res) => {
  const input = sanitizeAdInput(req.body);
  const pkg = PACKAGES[input.package];

  const ad = await BusinessAd.create({
    ...input,
    user: req.user ? req.user._id : undefined, // taken from the token, never from the request body
    status: 'pending',
    paymentStatus: 'unpaid',
    amount: pkg.price,
    duration: pkg.duration
  });

  res.status(201).json({
    message: 'Your advertisement was submitted.',
    adId: String(ad._id),
    packageName: pkg.name,
    amount: ad.amount,
    duration: ad.duration,
    ad
  });
}));

// GET /api/business-ads/active   (homepage)
router.get('/active', asyncHandler(async (req, res) => {
  const ads = await BusinessAd.find(liveQuery()).select(PUBLIC_FIELDS).sort({ priority: -1, approvedAt: -1 }).limit(20);
  res.json({ ads });
}));

// GET /api/business-ads?package=premium   (public, live ads only)
router.get('/', asyncHandler(async (req, res) => {
  const extra = {};
  if (PACKAGES[String(req.query.package || '')]) extra.package = String(req.query.package);
  const ads = await BusinessAd.find(liveQuery(extra)).select(PUBLIC_FIELDS).sort({ priority: -1, approvedAt: -1 }).limit(50);
  res.json({ ads });
}));

// GET /api/business-ads/my
router.get('/my', requireAuth, asyncHandler(async (req, res) => {
  const ads = await BusinessAd.find({ $or: [{ user: req.user._id }, { email: req.user.email }] })
    .sort({ createdAt: -1 }).limit(200);
  res.json({ ads });
}));

// GET /api/business-ads/:id
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Advertisement not found.');
  const ad = await BusinessAd.findById(req.params.id);
  if (!ad) throw new HttpError(404, 'Advertisement not found.');

  const privileged = sameOwner(ad, req.user) || (req.user && req.user.role === 'admin');
  if (privileged) return res.json(ad);

  const now = new Date();
  const live = ad.status === 'approved' && ad.startDate <= now && ad.endDate >= now;
  if (!live) throw new HttpError(404, 'Advertisement not found.');
  res.json(await BusinessAd.findById(ad._id).select(PUBLIC_FIELDS));
}));

// PUT /api/business-ads/:id   (owner, only while pending)
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ad = await loadOwned(req);
  if (ad.status !== 'pending') throw new HttpError(409, 'Only pending advertisements can be edited.');

  const input = sanitizeAdInput(req.body, { partial: true });
  if (input.package && input.package !== ad.package) {
    if (ad.paymentStatus !== 'unpaid') throw new HttpError(409, 'The package cannot be changed after payment was submitted.');
    ad.amount = PACKAGES[input.package].price;
    ad.duration = PACKAGES[input.package].duration;
  }
  ad.set(input);
  await ad.save();
  res.json({ ad });
}));

// DELETE /api/business-ads/:id   (owner; approved ads can only be removed by admin)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ad = await loadOwned(req);
  if (ad.status === 'approved' && req.user.role !== 'admin') {
    throw new HttpError(409, 'A live advertisement can only be removed by MSUKASHA admin.');
  }
  await ad.deleteOne();
  res.json({ message: 'Advertisement deleted.' });
}));

// POST /api/business-ads/:id/payment   (payment.html)
router.post('/:id/payment', requireAuth, asyncHandler(async (req, res) => {
  const ad = await loadOwned(req);
  const b = req.body || {};

  if (ad.paymentStatus === 'paid') throw new HttpError(409, 'This advertisement is already paid.');
  if (ad.status === 'rejected') throw new HttpError(409, 'This advertisement was rejected.');

  const method = String(b.paymentMethod || 'manual');
  if (method === 'online') throw new HttpError(501, 'Online payment is not available yet. Please use manual bank transfer.');
  if (method !== 'manual') throw new HttpError(400, 'Invalid payment method.');

  const transactionId = cleanText(b.transactionId, 80);
  if (!transactionId) throw new HttpError(400, 'Please enter the transaction / reference ID of your transfer.');
  const reused = await BusinessAd.exists({ _id: { $ne: ad._id }, 'payment.transactionId': transactionId });
  if (reused) throw new HttpError(409, 'This transaction ID was already used for another advertisement.');

  ad.payment = {
    method,
    payerName: cleanText(b.payerName, 120),
    payerEmail: cleanText(b.payerEmail, 254).toLowerCase(),
    transactionId,
    note: cleanText(b.paymentNote, 500),
    submittedAt: new Date()
  };
  ad.paymentStatus = 'pending_verification';
  await ad.save();

  res.json({ message: 'Payment submitted for verification.', paymentStatus: ad.paymentStatus, ad });
}));

// POST /api/business-ads/:id/impression  and  /click   (public counters)
['impression', 'click'].forEach((kind) => {
  router.post(`/:id/${kind}`, asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(404, 'Advertisement not found.');
    const field = kind === 'click' ? 'clicks' : 'impressions';
    await BusinessAd.updateOne(liveQuery({ _id: req.params.id }), { $inc: { [field]: 1 } });
    res.json({ ok: true });
  }));
});

module.exports = router;
