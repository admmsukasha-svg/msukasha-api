const express = require('express');
const Category = require('../models/Category');
const { asyncHandler } = require('../utils/helpers');
const router = express.Router();

// GET /api/categories  → tree [{...category, children: [...]}]  (public, only active)
router.get('/', asyncHandler(async (req, res) => {
  const all = await Category.find({ active: true }).sort({ order: 1, name: 1 }).lean();
  const nodes = all.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, icon: c.icon, description: c.description, restricted: c.restricted, parent: c.parent ? String(c.parent) : null, children: [] }));
  const map = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const roots = [];
  nodes.forEach((n) => { if (n.parent && map[n.parent]) map[n.parent].children.push(n); else roots.push(n); });
  res.json({ categories: roots });
}));

module.exports = router;
