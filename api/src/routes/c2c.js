const express = require('express');
const Ad = require('../models/Ad');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, cleanAsset, escapeRegex, clampInt, isObjectId, toPage } = require('../utils/helpers');

const router = express.Router();
const LISTING_DAYS = 30;
const PROHIBITED = /\b(weapon|firearm|ammunition|narcotic|heroin|cocaine|counterfeit|fake (id|passport|currency)|stolen)\b/i;

function fields(b, partial) {
  const out = {};
  if (b.title !== undefined || !partial) { out.title = cleanText(b.title, 200); if (out.title.length < 3) throw new HttpError(400, 'Title must be at least 3 characters.'); }
  if (b.description !== undefined) out.description = cleanText(b.description, 5000);
  if (b.price !== undefined || !partial) { const p = Number(b.price); if (!Number.isFinite(p) || p < 0) throw new HttpError(400, 'Enter a valid price in PKR.'); out.price = p; }
  if (b.cat !== undefined) out.cat = cleanText(b.cat, 50);
  if (b.city !== undefined) { out.city = cleanText(b.city, 80); out.location = out.city; }
  if (b.condition !== undefined) { if (!['new', 'used', 'refurbished'].includes(b.condition)) throw new HttpError(400, 'Invalid condition.'); out.condition = b.condition; }
  if (b.images !== undefined) { if (!Array.isArray(b.images)) throw new HttpError(400, 'images must be a list.'); out.images = b.images.slice(0, 8).map(cleanAsset).filter(Boolean); if (out.images[0]) out.img = out.images[0]; }
  if ((out.title && PROHIBITED.test(out.title)) || (out.description && PROHIBITED.test(out.description))) throw new HttpError(400, 'This listing appears to contain a prohibited item. See the Prohibited Items Policy.');
  return out;
}

// GET /api/c2c  (public; approved + not expired)
router.get('/', asyncHandler(async (req, res) => {
  const f = req.query;
  const q = { status: 'approved', $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: { $exists: false } }] };
  if (f.city) q.city = new RegExp(`^${escapeRegex(String(f.city).slice(0, 80))}$`, 'i');
  if (f.cat) q.cat = String(f.cat).slice(0, 50);
  if (['new', 'used', 'refurbished'].includes(f.condition)) q.condition = f.condition;
  const min = f.minPrice ? Number(f.minPrice) : NaN, max = f.maxPrice ? Number(f.maxPrice) : NaN;
  if (Number.isFinite(min) || Number.isFinite(max)) { q.price = {}; if (Number.isFinite(min)) q.price.$gte = min; if (Number.isFinite(max)) q.price.$lte = max; }
  if (f.q) { const rx = new RegExp(escapeRegex(String(f.q).slice(0, 80)), 'i'); q.$and = [{ $or: [{ title: rx }, { description: rx }] }]; }
  const { page, limit } = toPage(f);
  const sort = f.sort === 'price_asc' ? { price: 1 } : f.sort === 'price_desc' ? { price: -1 } : { createdAt: -1 };
  const [rows, total] = await Promise.all([Ad.find(q).select('-phone -email').sort(sort).skip((page - 1) * limit).limit(limit).populate('user', 'name city'), Ad.countDocuments(q)]);
  res.json({ listings: rows, total, page, pages: Math.ceil(total / limit) });
}));

// GET /api/c2c/mine
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  res.json({ listings: await Ad.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(200) });
}));

// GET /api/c2c/:id
router.get('/:id', asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Listing not found.');
  const ad = await Ad.findOne({ _id: req.params.id, status: 'approved' }).select('-phone -email').populate('user', 'name city createdAt');
  if (!ad || (ad.expiresAt && ad.expiresAt < new Date())) throw new HttpError(404, 'Listing not found.');
  res.json({ listing: ad });
}));

// POST /api/c2c  – goes to moderation (pending)
router.post('/', requireAuth, requireVerifiedEmail, asyncHandler(async (req, res) => {
  const ad = await Ad.create({ ...fields(req.body || {}, false), user: req.user._id, status: 'pending', expiresAt: new Date(Date.now() + LISTING_DAYS * 86400000) });
  res.status(201).json({ listing: ad, note: 'Your listing will appear after review.' });
}));

async function mine(req) {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Listing not found.');
  const ad = await Ad.findOne({ _id: req.params.id, user: req.user._id });
  if (!ad) throw new HttpError(404, 'Listing not found.');
  return ad;
}
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ad = await mine(req);
  ad.set(fields(req.body || {}, true));
  if (ad.status === 'approved' || ad.status === 'rejected') ad.status = 'pending';   // edits are re-moderated
  await ad.save();
  res.json({ listing: ad });
}));
router.post('/:id/renew', requireAuth, asyncHandler(async (req, res) => {
  const ad = await mine(req);
  if (!['approved', 'expired'].includes(ad.status)) throw new HttpError(400, 'This listing cannot be renewed.');
  ad.expiresAt = new Date(Date.now() + LISTING_DAYS * 86400000); ad.status = 'approved';
  await ad.save();
  res.json({ listing: ad });
}));
router.post('/:id/sold', requireAuth, asyncHandler(async (req, res) => {
  const ad = await mine(req); ad.status = 'sold'; await ad.save(); res.json({ listing: ad });
}));
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ad = await mine(req); await ad.deleteOne(); res.json({ message: 'Listing deleted.' });
}));

module.exports = router;
