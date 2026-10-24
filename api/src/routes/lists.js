const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, clampInt } = require('../utils/helpers');

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 200).map((i) => ({
    id: cleanText(i && i.id, 100),
    name: cleanText(i && i.name, 200),
    price: Number.isFinite(Number(i && i.price)) ? Number(i.price) : 0,
    qty: clampInt(i && i.qty, 1, 9999, 1),
    type: cleanText(i && i.type, 10),
    img: cleanText(i && i.img, 300)
  })).filter((i) => i.id);
}

// Builds /sync and /:uid routes for cart and wishlist.
module.exports = function makeListRouter(Model) {
  const router = express.Router();

  router.post('/sync', requireAuth, asyncHandler(async (req, res) => {
    const items = cleanItems(req.body && req.body.items);
    await Model.findOneAndUpdate({ user: req.user._id }, { items }, { upsert: true, setDefaultsOnInsert: true });
    res.json({ items });
  }));

  router.get('/:uid', requireAuth, asyncHandler(async (req, res) => {
    if (req.params.uid !== String(req.user._id)) throw new HttpError(403, 'You can only access your own list.');
    const doc = await Model.findOne({ user: req.user._id });
    res.json({ items: doc ? doc.items : [] });
  }));

  return router;
};
