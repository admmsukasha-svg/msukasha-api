const express = require('express');
const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, clampInt, isObjectId } = require('../utils/helpers');

const router = express.Router();
const METHODS = ['cod', 'jazzcash', 'easypaisa', 'bank_transfer', 'card'];
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const newOrderNumber = () => 'MS-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

// POST /api/orders
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const raw = Array.isArray(b.items) ? b.items.slice(0, 100) : [];
  if (!raw.length) throw new HttpError(400, 'Your order has no items.');

  const ship = b.shippingAddress || b.shipping || {};
  const shipping = {
    name: cleanText(ship.name || req.user.name, 120),
    phone: cleanText(ship.phone || req.user.phone, 30),
    city: cleanText(ship.city || req.user.city, 80),
    address: cleanText(ship.address, 300)
  };
  if (!shipping.name || !shipping.phone || !shipping.address) {
    throw new HttpError(400, 'Name, phone and delivery address are required.');
  }

  let method = String(b.paymentMethod || 'cod').toLowerCase().replace(/[\s-]/g, '_');
  if (method === 'cash_on_delivery') method = 'cod';
  if (!METHODS.includes(method)) throw new HttpError(400, 'Unsupported payment method.');

  const items = [];
  for (const it of raw) {
    const key = cleanText(it.productId || it.id, 100);
    const qty = clampInt(it.qty !== undefined ? it.qty : it.quantity, 1, 9999, 1);

    // Real products: price and seller come from the database, not the browser.
    const doc = isObjectId(key) ? await Product.findOne({ _id: key, status: 'active' }) : null;
    if (doc) {
      items.push({ product: doc._id, productKey: key, seller: doc.seller, name: doc.name, price: doc.price, qty });
    } else {
      // Static catalog items (p1, c2c-honda ...) are not in the DB yet, so the client price is used.
      const price = Number(it.price);
      if (!key || !Number.isFinite(price) || price < 0) throw new HttpError(400, 'An item in your order is invalid.');
      items.push({ productKey: key, name: cleanText(it.name, 200) || 'Item', price, qty });
    }
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shippingFee = 0; // set your delivery charges here when you have them
  const order = await Order.create({
    orderNumber: newOrderNumber(),
    buyer: req.user._id,
    items, shipping,
    paymentMethod: method,
    subtotal, shippingFee, total: subtotal + shippingFee,
    note: cleanText(b.note, 1000)
  });
  res.status(201).json({ order, orderId: String(order._id), orderNumber: order.orderNumber });
}));

// GET /api/orders/my
router.get('/my', requireAuth, asyncHandler(async (req, res) => {
  const orders = await Order.find({ buyer: req.user._id }).sort({ createdAt: -1 }).limit(200);
  res.json({ orders });
}));

// GET /api/orders/seller  (only the seller's own line items are shown)
router.get('/seller', requireAuth, asyncHandler(async (req, res) => {
  const docs = await Order.find({ 'items.seller': req.user._id }).sort({ createdAt: -1 }).limit(200);
  const orders = docs.map((d) => {
    const o = d.toJSON();
    o.items = o.items.filter((i) => String(i.seller) === String(req.user._id));
    o.total = o.items.reduce((s, i) => s + i.price * i.qty, 0);
    return o;
  });
  res.json({ orders });
}));

// PATCH /api/orders/:id/status  (seller of an item in the order, or admin)
router.patch('/:id/status', requireAuth, asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Order not found.');
  const status = String(req.body && req.body.status || '');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid order status.');

  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found.');
  const isSeller = order.items.some((i) => i.seller && String(i.seller) === String(req.user._id));
  if (!isSeller && req.user.role !== 'admin') throw new HttpError(403, 'You cannot update this order.');

  order.status = status;
  await order.save();
  res.json({ order });
}));

module.exports = router;
