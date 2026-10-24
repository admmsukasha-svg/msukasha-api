const express = require('express');
const Ad = require('../models/Ad');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const {
  asyncHandler, HttpError, cleanText, cleanImage, escapeRegex, clampInt
} = require('../utils/helpers');

const router = express.Router();

// POST /api/ads  (C2C classified ad; guests allowed, moderated before it appears)
router.post('/', optionalAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = cleanText(b.title || b.name, 200);
  if (!title) throw new HttpError(400, 'Advertisement title is required.');

  const phone = cleanText(b.phone || (req.user && req.user.phone), 30);
  const email = cleanText(b.email || (req.user && req.user.email), 254).toLowerCase();
  if (!phone && !email) throw new HttpError(400, 'Please provide a phone number or email so buyers can contact you.');

  const price = Number(b.price || 0);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Enter a valid price.');

  const ad = await Ad.create({
    user: req.user ? req.user._id : undefined,
    title, price, phone, email,
    description: cleanText(b.description, 5000),
    cat: cleanText(b.cat || b.category, 50),
    location: cleanText(b.location || b.city, 120),
    img: cleanImage(b.img),
    images: Array.isArray(b.images) ? b.images.slice(0, 10).map(cleanImage).filter(Boolean) : []
  });
  res.status(201).json({ ad, message: 'Your ad was submitted and will appear after review.' });
}));

// GET /api/ads  (public, approved only)
router.get('/', asyncHandler(async (req, res) => {
  const q = { status: 'approved' };
  const f = req.query;
  if (f.cat) q.cat = String(f.cat).slice(0, 50);
  if (f.q) {
    const rx = new RegExp(escapeRegex(String(f.q).slice(0, 80)), 'i');
    q.$or = [{ title: rx }, { description: rx }];
  }
  const limit = clampInt(f.limit, 1, 100, 24);
  const page = clampInt(f.page, 1, 10000, 1);
  const ads = await Ad.find(q).select('-email -phone -user').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  res.json({ ads });
}));

// GET /api/ads/my
router.get('/my', requireAuth, asyncHandler(async (req, res) => {
  const ads = await Ad.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(200);
  res.json({ ads });
}));

module.exports = router;
