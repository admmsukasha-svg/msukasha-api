const express = require('express');
const Product = require('../models/Product');
const Rfq = require('../models/Rfq');
const Quotation = require('../models/Quotation');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const Favorite = require('../models/Favorite');
const BusinessProfile = require('../models/BusinessProfile');
const Store = require('../models/Store');
const SupplierVerification = require('../models/SupplierVerification');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

// GET /api/dashboard/supplier  – real, database-backed numbers only
router.get('/dashboard/supplier', requireAuth, asyncHandler(async (req, res) => {
  const me = req.user._id;
  const [profile, store, verification, statusAgg, views, rfqsReceived, quotesSent, quotesAccepted, convs, unreadNotes, savedBy] = await Promise.all([
    BusinessProfile.findOne({ owner: me }), Store.findOne({ owner: me }), SupplierVerification.findOne({ owner: me }),
    Product.aggregate([{ $match: { seller: me } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Product.aggregate([{ $match: { seller: me } }, { $group: { _id: null, v: { $sum: '$views' } } }]),
    Rfq.countDocuments({ $or: [{ recipients: me }, { visibility: 'public', status: 'open', buyer: { $ne: me } }] }),
    Quotation.countDocuments({ supplier: me }), Quotation.countDocuments({ supplier: me, status: 'accepted' }),
    Conversation.find({ participants: me }).select('unread').lean(),
    Notification.countDocuments({ user: me, readAt: { $exists: false } }),
    Favorite.countDocuments({ kind: 'supplier', ref: (await BusinessProfile.findOne({ owner: me }).select('_id'))?._id })
  ]);
  const products = Object.fromEntries(statusAgg.map((s) => [s._id, s.n]));
  const total = Object.values(products).reduce((a, b) => a + b, 0);
  const unreadMessages = convs.reduce((a, c) => a + ((c.unread && c.unread[String(me)]) || 0), 0);
  const completion = profile ? profile.completion() : { percent: 0, missing: ['Company profile'] };

  // Contextual, honest next actions (no promises about leads or orders).
  const next = [];
  if (!req.user.emailVerified) next.push({ key: 'verify_email', text: 'Verify your email address to publish your store and products.', href: '/dashboard/settings' });
  if (!profile) next.push({ key: 'profile', text: 'Create your business profile to help buyers understand your business.', href: '/dashboard/profile' });
  else if (completion.percent < 100) next.push({ key: 'complete_profile', text: `Complete your company profile (${completion.percent}% done). Missing: ${completion.missing.join(', ')}.`, href: '/dashboard/profile' });
  if (profile && (!store || store.status !== 'published')) next.push({ key: 'publish_store', text: 'Publish your digital store so buyers can find you.', href: '/dashboard/store' });
  if (total < 5) next.push({ key: 'add_products', text: `Add your first five products to build a useful catalogue (${total} so far).`, href: '/dashboard/products/new' });
  if (profile && (!verification || verification.documentsStatus === 'none')) next.push({ key: 'verification', text: 'Submit business documents to apply for document review.', href: '/dashboard/verification' });
  res.json({
    profileCompletion: completion, storeStatus: store ? store.status : 'none',
    verificationLevels: SupplierVerification.levelsFor(req.user, verification), documentsStatus: verification ? verification.documentsStatus : 'none',
    products: { total, byStatus: products }, productViews: views[0] ? views[0].v : 0,
    rfqsAvailable: rfqsReceived, quotationsSent: quotesSent, quotationsAccepted: quotesAccepted,
    unreadMessages, unreadNotifications: unreadNotes, timesSaved: savedBy, nextActions: next
  });
}));

// GET /api/dashboard/buyer
router.get('/dashboard/buyer', requireAuth, asyncHandler(async (req, res) => {
  const me = req.user._id;
  const [rfqs, openRfqs, quotes, favs, convs] = await Promise.all([
    Rfq.countDocuments({ buyer: me }), Rfq.countDocuments({ buyer: me, status: 'open' }),
    Rfq.aggregate([{ $match: { buyer: me } }, { $group: { _id: null, n: { $sum: '$quotationCount' } } }]),
    Favorite.countDocuments({ user: me }), Conversation.find({ participants: me }).select('unread').lean()
  ]);
  res.json({ rfqs, openRfqs, quotationsReceived: quotes[0] ? quotes[0].n : 0, saved: favs, unreadMessages: convs.reduce((a, c) => a + ((c.unread && c.unread[String(me)]) || 0), 0) });
}));

module.exports = router;
