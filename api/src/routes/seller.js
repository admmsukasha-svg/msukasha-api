const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

// GET /api/seller/stats
router.get('/stats', requireAuth, requireRole('seller', 'admin'), asyncHandler(async (req, res) => {
  const me = String(req.user._id);
  const [products, orders] = await Promise.all([
    Product.countDocuments({ seller: req.user._id }),
    Order.find({ 'items.seller': req.user._id }).select('items status').limit(5000).lean()
  ]);

  const stats = { products, orders: orders.length, pendingOrders: 0, deliveredOrders: 0, revenue: 0 };
  orders.forEach((o) => {
    if (o.status === 'pending') stats.pendingOrders++;
    if (o.status === 'delivered') stats.deliveredOrders++;
    if (o.status !== 'cancelled') {
      stats.revenue += o.items.filter((i) => String(i.seller) === me).reduce((s, i) => s + i.price * i.qty, 0);
    }
  });
  res.json({ stats });
}));

module.exports = router;
