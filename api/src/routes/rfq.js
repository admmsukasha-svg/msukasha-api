const express = require('express');
const Rfq = require('../models/Rfq');
const Quotation = require('../models/Quotation');
const Store = require('../models/Store');
const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');
const { notify } = require('../lib/notify');
const { sendTemplate, APP_URL } = require('../lib/mailer');
const { audit } = require('../lib/audit');
const { asyncHandler, HttpError, cleanText, cleanAsset, isObjectId, toPage, parseDate } = require('../utils/helpers');

const router = express.Router();
const CUR = ['USD', 'PKR'];

const num = (v, name, { min = 0, int = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) throw new HttpError(400, `Enter a valid ${name}.`);
  return n;
};

// Buyer contact details are never part of RFQ output seen by suppliers.
function supplierView(rfq, buyer) {
  const r = rfq.toJSON();
  delete r.recipients;
  r.buyer = { name: (buyer && buyer.name ? buyer.name.split(' ')[0] : 'Buyer'), country: buyer && buyer.country ? buyer.country : '' };
  return r;
}

// POST /api/rfqs
router.post('/', requireAuth, requireVerifiedEmail, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = cleanText(b.title, 200);
  if (title.length < 3) throw new HttpError(400, 'Describe the product you need.');
  const currency = b.currency || 'USD';
  if (!CUR.includes(currency)) throw new HttpError(400, 'Currency must be USD or PKR.');
  const destinationCountry = cleanText(b.destinationCountry, 2).toUpperCase();
  if (destinationCountry.length !== 2) throw new HttpError(400, 'Choose a delivery country.');
  const visibility = b.visibility === 'public' ? 'public' : 'invited';

  let recipients = [];
  if (Array.isArray(b.recipients)) {
    const ids = [...new Set(b.recipients.map(String).filter(isObjectId))].slice(0, 20);
    const stores = await Store.find({ owner: { $in: ids }, status: 'published', 'contactPreferences.allowRfq': true }).select('owner').lean();
    recipients = stores.map((s) => s.owner).filter((id) => String(id) !== String(req.user._id));
  }
  if (visibility === 'invited' && !recipients.length) throw new HttpError(400, 'Choose at least one supplier, or make the request visible to eligible suppliers.');

  const rfq = await Rfq.create({
    buyer: req.user._id, title, specifications: cleanText(b.specifications, 4000),
    quantity: num(b.quantity, 'quantity', { min: 1 }), unit: cleanText(b.unit, 20) || 'pc',
    targetPrice: b.targetPrice !== undefined && b.targetPrice !== '' ? num(b.targetPrice, 'target price') : undefined,
    currency, destinationCountry, destinationCity: cleanText(b.destinationCity, 80),
    requiredBy: b.requiredBy ? parseDate(b.requiredBy) : undefined,
    attachments: Array.isArray(b.attachments) ? b.attachments.slice(0, 5).map(cleanAsset).filter(Boolean) : [],
    category: isObjectId(String(b.category || '')) ? b.category : undefined,
    product: isObjectId(String(b.product || '')) ? b.product : undefined,
    visibility, recipients
  });

  const users = await User.find({ _id: { $in: recipients } }).select('name email notificationPrefs');
  await Promise.all(users.map(async (u) => {
    await notify(u._id, 'rfq', 'New request for quotation', title, `/dashboard/rfqs/${rfq._id}`);
    if (u.notificationPrefs.email) await sendTemplate('new_rfq', u.email, { name: u.name, subject: title, link: `${APP_URL()}/dashboard/rfqs/${rfq._id}` });
  }));
  res.status(201).json({ rfq });
}));

// GET /api/rfqs/mine  (buyer)
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit } = toPage(req.query);
  const q = { buyer: req.user._id };
  const [rfqs, total] = await Promise.all([Rfq.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Rfq.countDocuments(q)]);
  res.json({ rfqs, total, page, pages: Math.ceil(total / limit) });
}));

// GET /api/rfqs/received  (supplier: invited + public open RFQs)
router.get('/received', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role === 'buyer') throw new HttpError(403, 'Create a business profile to receive requests.');
  const { page, limit } = toPage(req.query);
  const q = { buyer: { $ne: req.user._id }, $or: [{ recipients: req.user._id }, { visibility: 'public', status: 'open' }] };
  const [rows, total] = await Promise.all([Rfq.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Rfq.countDocuments(q)]);
  const buyers = Object.fromEntries((await User.find({ _id: { $in: rows.map((r) => r.buyer) } }).select('name country')).map((u) => [String(u._id), u]));
  const mine = new Set((await Quotation.find({ supplier: req.user._id, rfq: { $in: rows.map((r) => r._id) } }).select('rfq')).map((x) => String(x.rfq)));
  res.json({ rfqs: rows.map((r) => ({ ...supplierView(r, buyers[String(r.buyer)]), quoted: mine.has(String(r._id)) })), total, page, pages: Math.ceil(total / limit) });
}));

async function loadRfq(req) {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Request not found.');
  const rfq = await Rfq.findById(req.params.id);
  if (!rfq) throw new HttpError(404, 'Request not found.');
  return rfq;
}
const canSupplierSee = (rfq, uid) => rfq.recipients.some((r) => String(r) === String(uid)) || (rfq.visibility === 'public');

// GET /api/rfqs/:id
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const rfq = await loadRfq(req);
  if (String(rfq.buyer) === String(req.user._id)) {
    const quotations = await Quotation.find({ rfq: rfq._id }).sort({ unitPrice: 1 });
    const profiles = Object.fromEntries((await BusinessProfile.find({ owner: { $in: quotations.map((x) => x.supplier) } }).select('owner companyName slug country')).map((p) => [String(p.owner), p]));
    return res.json({ role: 'buyer', rfq, quotations: quotations.map((x) => ({ ...x.toJSON(), supplierProfile: profiles[String(x.supplier)] ? { companyName: profiles[String(x.supplier)].companyName, slug: profiles[String(x.supplier)].slug, country: profiles[String(x.supplier)].country } : null })) });
  }
  if (!canSupplierSee(rfq, req.user._id)) throw new HttpError(404, 'Request not found.');   // 404, not 403: do not reveal existence
  const buyer = await User.findById(rfq.buyer).select('name country');
  const quotation = await Quotation.findOne({ rfq: rfq._id, supplier: req.user._id });
  res.json({ role: 'supplier', rfq: supplierView(rfq, buyer), quotation });
}));

// POST /api/rfqs/:id/quotations  (supplier)
router.post('/:id/quotations', requireAuth, requireVerifiedEmail, asyncHandler(async (req, res) => {
  const rfq = await loadRfq(req);
  if (req.user.role === 'buyer') throw new HttpError(403, 'Create a business profile to send quotations.');
  if (String(rfq.buyer) === String(req.user._id) || !canSupplierSee(rfq, req.user._id)) throw new HttpError(404, 'Request not found.');
  if (rfq.status !== 'open') throw new HttpError(400, 'This request is no longer open.');
  if (!(await Store.exists({ owner: req.user._id, status: 'published' }))) throw new HttpError(403, 'Publish your store before sending quotations.');
  const b = req.body || {};
  if (!CUR.includes(b.currency)) throw new HttpError(400, 'Currency must be USD or PKR.');
  const validUntil = parseDate(b.validUntil);
  if (validUntil <= new Date()) throw new HttpError(400, 'Quotation validity must be in the future.');
  let q;
  try {
    q = await Quotation.create({
      rfq: rfq._id, supplier: req.user._id, unitPrice: num(b.unitPrice, 'unit price'), currency: b.currency,
      moq: b.moq ? num(b.moq, 'MOQ', { min: 1, int: true }) : undefined,
      availableQuantity: b.availableQuantity !== undefined && b.availableQuantity !== '' ? num(b.availableQuantity, 'available quantity', { int: true }) : undefined,
      leadTimeDays: b.leadTimeDays !== undefined && b.leadTimeDays !== '' ? num(b.leadTimeDays, 'lead time', { int: true }) : undefined,
      shippingDetails: cleanText(b.shippingDetails, 1000), validUntil, terms: cleanText(b.terms, 2000)
    });
  } catch (e) {
    if (e.code === 11000) throw new HttpError(409, 'You have already sent a quotation for this request.');
    throw e;
  }
  await Rfq.updateOne({ _id: rfq._id }, { $inc: { quotationCount: 1 } });
  const buyer = await User.findById(rfq.buyer);
  await notify(buyer._id, 'quotation', 'New quotation received', rfq.title, `/dashboard/rfqs/${rfq._id}`);
  if (buyer.notificationPrefs.email) await sendTemplate('new_quotation', buyer.email, { name: buyer.name, subject: rfq.title, link: `${APP_URL()}/dashboard/rfqs/${rfq._id}` });
  res.status(201).json({ quotation: q });
}));

// POST /api/rfqs/:id/quotations/:qid/withdraw  (supplier who owns it)
router.post('/:id/quotations/:qid/withdraw', requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.qid)) throw new HttpError(404, 'Quotation not found.');
  const q = await Quotation.findOne({ _id: req.params.qid, rfq: req.params.id, supplier: req.user._id });
  if (!q) throw new HttpError(404, 'Quotation not found.');
  if (q.status !== 'submitted') throw new HttpError(400, `A ${q.status} quotation cannot be withdrawn.`);
  q.status = 'withdrawn'; await q.save();
  res.json({ quotation: q });
}));

// POST /api/rfqs/:id/quotations/:qid/accept  (buyer)
router.post('/:id/quotations/:qid/accept', requireAuth, asyncHandler(async (req, res) => {
  const rfq = await loadRfq(req);
  if (String(rfq.buyer) !== String(req.user._id)) throw new HttpError(404, 'Request not found.');
  if (rfq.status !== 'open') throw new HttpError(400, 'This request is no longer open.');
  if (!isObjectId(req.params.qid)) throw new HttpError(404, 'Quotation not found.');
  const q = await Quotation.findOne({ _id: req.params.qid, rfq: rfq._id, status: 'submitted' });
  if (!q) throw new HttpError(404, 'Quotation not found.');
  if (q.validUntil < new Date()) throw new HttpError(400, 'This quotation has expired.');
  q.status = 'accepted'; await q.save();
  await Quotation.updateMany({ rfq: rfq._id, _id: { $ne: q._id }, status: 'submitted' }, { status: 'rejected' });
  rfq.status = 'awarded'; rfq.awardedQuotation = q._id; await rfq.save();
  await notify(q.supplier, 'quotation', 'Your quotation was accepted', rfq.title, `/dashboard/rfqs/${rfq._id}`);
  res.json({ rfq, quotation: q, note: 'MSUKASHA does not process payment or guarantee this deal. Agree final terms directly with the supplier.' });
}));

// POST /api/rfqs/:id/close  (buyer)
router.post('/:id/close', requireAuth, asyncHandler(async (req, res) => {
  const rfq = await loadRfq(req);
  if (String(rfq.buyer) !== String(req.user._id)) throw new HttpError(404, 'Request not found.');
  if (rfq.status !== 'open') throw new HttpError(400, 'This request is already closed.');
  rfq.status = req.body && req.body.cancel ? 'cancelled' : 'closed';
  await rfq.save();
  await audit(req, 'rfq.close', { type: 'rfq', id: rfq._id });
  res.json({ rfq });
}));

module.exports = router;
