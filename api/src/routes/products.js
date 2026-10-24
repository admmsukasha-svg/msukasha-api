const express = require('express');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Store = require('../models/Store');
const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const SupplierVerification = require('../models/SupplierVerification');
const Referral = require('../models/Referral');
const { requireAuth, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const {
  asyncHandler, HttpError, cleanText, cleanAsset, escapeRegex, clampInt, isObjectId, uniqueSlug, toPage
} = require('../utils/helpers');

const router = express.Router();
const CURRENCIES = ['USD', 'PKR'];
// Fields that, when changed on a live product, send it back to moderation.
const MODERATED = ['name', 'description', 'images', 'img', 'category', 'short'];

async function buildProduct(b, partial) {
  const out = {};
  const name = b.name !== undefined ? b.name : b.title;
  if (name !== undefined || !partial) {
    out.name = cleanText(name, 200);
    if (out.name.length < 3) throw new HttpError(400, 'Product title must be at least 3 characters.');
  }
  if (b.priceOnRequest !== undefined) out.priceOnRequest = !!b.priceOnRequest;
  if (b.price !== undefined && b.price !== '' && b.price !== null) {
    const price = Number(b.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Enter a valid price.');
    out.price = price;
  } else if (!partial && !b.priceOnRequest) {
    throw new HttpError(400, 'Enter a price or mark the product as "price on request".');
  }
  if (b.currency !== undefined) {
    if (!CURRENCIES.includes(b.currency)) throw new HttpError(400, 'Currency must be USD or PKR.');
    out.currency = b.currency;
  }
  if (b.priceTiers !== undefined) {
    if (!Array.isArray(b.priceTiers)) throw new HttpError(400, 'priceTiers must be a list.');
    const tiers = b.priceTiers.slice(0, 8).map((t) => ({ minQty: Number(t.minQty), price: Number(t.price) }));
    if (tiers.some((t) => !Number.isFinite(t.minQty) || t.minQty < 1 || !Number.isFinite(t.price) || t.price < 0)) throw new HttpError(400, 'Invalid price tier.');
    out.priceTiers = tiers.sort((a, c) => a.minQty - c.minQty);
  }
  if (b.short !== undefined) out.short = cleanText(b.short, 100);
  if (b.description !== undefined) out.description = cleanText(b.description, 5000);
  if (b.type !== undefined) {
    if (!['b2b', 'c2c'].includes(b.type)) throw new HttpError(400, 'Type must be b2b or c2c.');
    out.type = b.type;
  }
  const cat = b.cat !== undefined ? b.cat : undefined;
  if (cat !== undefined) out.cat = cleanText(cat, 50);
  if (b.category !== undefined && b.category !== '') {
    if (!isObjectId(String(b.category)) || !(await Category.exists({ _id: b.category, active: true }))) throw new HttpError(400, 'Choose a valid category.');
    out.category = b.category;
  }
  if (b.subcategory !== undefined && b.subcategory !== '') {
    if (!isObjectId(String(b.subcategory)) || !(await Category.exists({ _id: b.subcategory, active: true }))) throw new HttpError(400, 'Choose a valid subcategory.');
    out.subcategory = b.subcategory;
  }
  if (b.unit !== undefined) out.unit = cleanText(b.unit, 20) || 'pc';
  const moq = b.moq !== undefined ? b.moq : b.minOrder;
  if (moq !== undefined) out.moq = clampInt(moq, 1, 1000000000, 1);
  if (b.stock !== undefined) out.stock = clampInt(b.stock, 0, 1000000000, 0);
  if (b.availableQuantity !== undefined && b.availableQuantity !== '') out.availableQuantity = clampInt(b.availableQuantity, 0, 1000000000, 0);
  if (b.leadTimeDays !== undefined && b.leadTimeDays !== '') out.leadTimeDays = clampInt(b.leadTimeDays, 0, 730, 0);
  if (b.sampleAvailable !== undefined) out.sampleAvailable = !!b.sampleAvailable;
  if (b.customization !== undefined) out.customization = cleanText(b.customization, 500);
  if (b.shippingTerms !== undefined) out.shippingTerms = cleanText(b.shippingTerms, 500);
  if (b.originCountry !== undefined) out.originCountry = cleanText(b.originCountry, 2).toUpperCase();
  if (b.country !== undefined) out.country = cleanText(b.country, 2).toUpperCase();
  if (b.city !== undefined) out.city = cleanText(b.city, 80);
  if (b.location !== undefined) out.location = cleanText(b.location, 120);
  if (b.specifications !== undefined) {
    if (!Array.isArray(b.specifications)) throw new HttpError(400, 'specifications must be a list.');
    out.specifications = b.specifications.slice(0, 30).map((s) => ({ key: cleanText(s.key, 60), value: cleanText(s.value, 200) })).filter((s) => s.key && s.value);
  }
  if (b.variations !== undefined) {
    if (!Array.isArray(b.variations)) throw new HttpError(400, 'variations must be a list.');
    out.variations = b.variations.slice(0, 5).map((v) => ({ name: cleanText(v.name, 60), options: (Array.isArray(v.options) ? v.options : []).slice(0, 20).map((o) => cleanText(o, 60)).filter(Boolean) })).filter((v) => v.name && v.options.length);
  }
  if (b.img !== undefined) out.img = cleanAsset(b.img);
  if (b.fallback !== undefined) out.fallback = cleanAsset(b.fallback);
  if (b.images !== undefined) {
    if (!Array.isArray(b.images)) throw new HttpError(400, 'images must be a list.');
    out.images = b.images.slice(0, 10).map(cleanAsset).filter(Boolean);
    if (out.images.length && b.img === undefined) out.img = out.images[0];
  }
  return out;
}

async function ownedProduct(req) {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Product not found.');
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found.');
  if (String(product.seller) !== String(req.user._id)) throw new HttpError(403, 'This is not your product.');
  return product;
}

// Owners whose products must NOT be public: suspended stores, deactivated users.
async function hiddenSellerIds() {
  const [suspended, inactive] = await Promise.all([
    Store.find({ status: 'suspended' }).select('owner').lean(),
    User.find({ $or: [{ isActive: false }, { deletedAt: { $exists: true } }] }).select('_id').lean()
  ]);
  return [...suspended.map((s) => s.owner), ...inactive.map((u) => u._id)];
}

async function categoryWithDescendants(id) {
  const ids = [id];
  const kids = await Category.find({ parent: id }).select('_id').lean();
  kids.forEach((k) => ids.push(k._id));
  return ids;
}

// GET /api/products  (public; server-side search, filters, sort, pagination)
router.get('/', asyncHandler(async (req, res) => {
  const f = req.query;
  const q = { status: 'active' };
  const hidden = await hiddenSellerIds();
  if (hidden.length) q.seller = { $nin: hidden };
  if (['b2b', 'c2c'].includes(f.type)) q.type = f.type;
  if (f.cat) q.cat = String(f.cat).slice(0, 50);
  if (f.category && isObjectId(String(f.category))) {
    const ids = await categoryWithDescendants(String(f.category));
    q.$or = [{ category: { $in: ids } }, { subcategory: { $in: ids } }];
  }
  if (f.seller && isObjectId(String(f.seller))) q.seller = String(f.seller);
  if (f.country) q.country = String(f.country).toUpperCase().slice(0, 2);
  if (f.city) q.city = new RegExp(`^${escapeRegex(String(f.city).slice(0, 80))}$`, 'i');
  if (CURRENCIES.includes(f.currency)) q.currency = f.currency;
  if (f.maxMoq) q.moq = { $lte: clampInt(f.maxMoq, 1, 1000000000, 1000000000) };
  const min = f.minPrice !== undefined && f.minPrice !== '' ? Number(f.minPrice) : NaN;
  const max = f.maxPrice !== undefined && f.maxPrice !== '' ? Number(f.maxPrice) : NaN;
  if (Number.isFinite(min) || Number.isFinite(max)) {
    q.price = {};
    if (Number.isFinite(min)) q.price.$gte = min;
    if (Number.isFinite(max)) q.price.$lte = max;
  }
  if (f.verified === 'documents') {
    const ok = await SupplierVerification.find({ documentsStatus: 'approved' }).select('owner').lean();
    q.seller = { ...(typeof q.seller === 'object' && !Array.isArray(q.seller) ? q.seller : {}), $in: ok.map((v) => v.owner) };
  }
  let sort = { createdAt: -1 };
  let proj = {};
  if (f.q) {
    q.$text = { $search: String(f.q).slice(0, 80) };
    if (f.sort !== 'recent' && !f.sort?.startsWith('price')) { proj = { score: { $meta: 'textScore' } }; sort = { score: { $meta: 'textScore' } }; }
  }
  if (f.sort === 'price_asc') sort = { price: 1, createdAt: -1 };
  if (f.sort === 'price_desc') sort = { price: -1, createdAt: -1 };
  const { page, limit } = toPage(f);

  const [products, total] = await Promise.all([
    Product.find(q, proj).sort(sort).skip((page - 1) * limit).limit(limit).populate('seller', 'name companyName city country'),
    Product.countDocuments(q)
  ]);
  res.json({ products, total, page, pages: Math.ceil(total / limit) });
}));

// GET /api/products/my?status=
router.get('/my', requireAuth, asyncHandler(async (req, res) => {
  const q = { seller: req.user._id };
  if (Product.STATUSES.includes(req.query.status)) q.status = req.query.status;
  const { page, limit } = toPage(req.query);
  const [products, total] = await Promise.all([
    Product.find(q).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit), Product.countDocuments(q)
  ]);
  res.json({ products, total, page, pages: Math.ceil(total / limit) });
}));

// GET /api/products/my/:id  (owner only, any status)
router.get('/my/:id', requireAuth, asyncHandler(async (req, res) => {
  res.json({ product: await ownedProduct(req) });
}));

// GET /api/products/:id  (public: id or slug)
router.get('/:id', asyncHandler(async (req, res) => {
  const key = String(req.params.id).slice(0, 240);
  const cond = isObjectId(key) ? { _id: key } : { slug: key };
  const product = await Product.findOne({ ...cond, status: 'active' }).populate('seller', 'name companyName city country');
  if (!product || (await hiddenSellerIds()).some((id) => String(id) === String(product.seller._id))) throw new HttpError(404, 'Product not found.');
  Product.updateOne({ _id: product._id }, { $inc: { views: 1 } }).exec();
  const profile = await BusinessProfile.findOne({ owner: product.seller._id }).select('companyName slug country city');
  res.json({ product, supplier: profile ? { companyName: profile.companyName, slug: profile.slug, country: profile.country, city: profile.city } : null });
}));

// POST /api/products  – creates a DRAFT
router.post('/', requireAuth, requireRole('seller', 'admin'), asyncHandler(async (req, res) => {
  const data = await buildProduct(req.body || {}, false);
  const slug = await uniqueSlug(Product, data.name, 'slug');
  const product = await Product.create({ ...data, slug, seller: req.user._id, status: 'draft' });
  res.status(201).json({ product });
}));

// PUT /api/products/:id
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const product = await ownedProduct(req);
  if (product.status === 'archived') throw new HttpError(400, 'Archived products cannot be edited.');
  const data = await buildProduct(req.body || {}, true);
  const touched = MODERATED.some((k) => data[k] !== undefined && String(data[k]) !== String(product[k]));
  product.set(data);
  if (product.status === 'active' && touched) { product.status = 'pending_review'; product.reviewedAt = undefined; }
  if (product.status === 'rejected') product.status = 'draft';
  await product.save();
  res.json({ product });
}));

// POST /api/products/:id/submit  – draft -> pending_review
router.post('/:id/submit', requireAuth, asyncHandler(async (req, res) => {
  const product = await ownedProduct(req);
  if (!['draft', 'rejected'].includes(product.status)) throw new HttpError(400, 'Only drafts can be submitted for review.');
  if (!req.user.emailVerified) throw new HttpError(403, 'Verify your email before submitting products.', 'EMAIL_NOT_VERIFIED');
  if (!product.category) throw new HttpError(400, 'Choose a category first.');
  if (!product.images.length && !product.img) throw new HttpError(400, 'Add at least one product image.');
  if (product.price == null && !product.priceOnRequest) throw new HttpError(400, 'Add a price or mark it as price on request.');
  product.status = 'pending_review'; product.rejectionReason = '';
  await product.save();
  res.json({ product });
}));

const transition = (path, from, to) => router.post(`/:id/${path}`, requireAuth, asyncHandler(async (req, res) => {
  const product = await ownedProduct(req);
  if (!from.includes(product.status)) throw new HttpError(400, `Cannot ${path} a product that is ${product.status}.`);
  product.status = to;
  await product.save();
  res.json({ product });
}));
transition('pause', ['active'], 'paused');
transition('resume', ['paused', 'inactive'], 'active');   // approved earlier, so no new review needed
transition('archive', ['draft', 'active', 'paused', 'rejected', 'pending_review', 'inactive'], 'archived');

// DELETE /api/products/:id  – owners may delete their own listings; moderation history is kept in ModerationAction.
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const product = await ownedProduct(req);
  await product.deleteOne();
  await audit(req, 'product.delete', { type: 'product', id: product._id });
  res.json({ message: 'Product deleted.' });
}));

module.exports = router;
