const express = require('express');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const Product = require('../models/Product');
const Ad = require('../models/Ad');
const Rfq = require('../models/Rfq');
const Quotation = require('../models/Quotation');
const Store = require('../models/Store');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');
const { notify } = require('../lib/notify');
const { sendTemplate, APP_URL } = require('../lib/mailer');
const { asyncHandler, HttpError, cleanText, isObjectId, toPage } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth);

const MAX_NEW_CONVERSATIONS_PER_DAY = 20;
const MAX_MESSAGES_PER_HOUR = 60;

const keyFor = (a, b, refType, refId) => `${[String(a), String(b)].sort().join('_')}|${refType}|${refId || ''}`;
const isParticipant = (c, uid) => c.participants.some((p) => String(p) === String(uid));

async function validateReference(me, other, refType, refId) {
  switch (refType) {
    case 'product': {
      if (!isObjectId(refId)) throw new HttpError(400, 'Invalid product.');
      const p = await Product.findOne({ _id: refId, status: 'active' }).select('seller name');
      if (!p || String(p.seller) !== String(other)) throw new HttpError(400, 'This product does not belong to that supplier.');
      return p.name;
    }
    case 'c2c': {
      if (!isObjectId(refId)) throw new HttpError(400, 'Invalid listing.');
      const a = await Ad.findOne({ _id: refId, status: 'approved' }).select('user title');
      if (!a || String(a.user) !== String(other)) throw new HttpError(400, 'This listing does not belong to that seller.');
      return a.title;
    }
    case 'supplier': {
      const s = await Store.findOne({ owner: other, status: 'published' });
      if (!s || !s.contactPreferences.allowInquiries) throw new HttpError(400, 'This supplier is not accepting inquiries.');
      return 'Supplier inquiry';
    }
    case 'rfq': {
      if (!isObjectId(refId)) throw new HttpError(400, 'Invalid request.');
      const r = await Rfq.findById(refId).select('buyer title recipients visibility');
      if (!r) throw new HttpError(400, 'Request not found.');
      const buyerIsMe = String(r.buyer) === String(me), buyerIsOther = String(r.buyer) === String(other);
      if (!buyerIsMe && !buyerIsOther) throw new HttpError(403, 'You are not part of this request.');
      const supplier = buyerIsMe ? other : me;
      const invited = r.recipients.some((x) => String(x) === String(supplier));
      const quoted = await Quotation.exists({ rfq: r._id, supplier });
      if (!invited && !quoted) throw new HttpError(403, 'You are not part of this request.');
      return r.title;
    }
    default: throw new HttpError(400, 'Conversation type not supported.');
  }
}

// POST /api/conversations  { recipientId, refType, refId, subject?, text }
router.post('/', requireVerifiedEmail, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const me = String(req.user._id), other = String(b.recipientId || '');
  const text = cleanText(b.text, 2000);
  if (!isObjectId(other) || other === me) throw new HttpError(400, 'Invalid recipient.');
  if (!text) throw new HttpError(400, 'Message cannot be empty.');
  const refType = String(b.refType || '');
  const refId = cleanText(b.refId, 60);
  if (!(await User.exists({ _id: other, isActive: true, deletedAt: { $exists: false } }))) throw new HttpError(404, 'Recipient not found.');
  const refName = await validateReference(me, other, refType, refId);

  const key = keyFor(me, other, refType, refId);
  let conv = await Conversation.findOne({ key });
  if (conv && conv.blockedBy.length) throw new HttpError(403, 'You cannot message in this conversation.');
  if (!conv) {
    const since = new Date(Date.now() - 86400000);
    const started = await Conversation.countDocuments({ participants: req.user._id, createdAt: { $gte: since }, 'participants.0': req.user._id });
    if (started >= MAX_NEW_CONVERSATIONS_PER_DAY) throw new HttpError(429, 'You have started too many conversations today. Please try again tomorrow.');
    conv = await Conversation.create({ key, participants: [req.user._id, other], refType, refId, subject: cleanText(b.subject, 200) || refName });
  }
  const message = await appendMessage(conv, req.user, text);
  res.status(201).json({ conversation: conv, message });
}));

async function appendMessage(conv, user, text) {
  const since = new Date(Date.now() - 3600000);
  if ((await ChatMessage.countDocuments({ sender: user._id, createdAt: { $gte: since } })) >= MAX_MESSAGES_PER_HOUR) throw new HttpError(429, 'You are sending messages too quickly.');
  const last = await ChatMessage.findOne({ conversation: conv._id, sender: user._id }).sort({ createdAt: -1 }).select('text createdAt');
  if (last && last.text === text && Date.now() - last.createdAt.getTime() < 60000) throw new HttpError(429, 'Duplicate message ignored.');

  const message = await ChatMessage.create({ conversation: conv._id, sender: user._id, text, readBy: [user._id] });
  const otherId = conv.participants.find((p) => String(p) !== String(user._id));
  conv.lastMessageAt = new Date(); conv.lastMessageText = text.slice(0, 140);
  conv.unread.set(String(otherId), (conv.unread.get(String(otherId)) || 0) + 1);
  conv.unread.set(String(user._id), 0);
  await conv.save();
  const other = await User.findById(otherId).select('name email notificationPrefs');
  await notify(otherId, 'message', 'New message', conv.subject, `/dashboard/messages/${conv._id}`);
  // The email never includes the message text.
  if (other && other.notificationPrefs.email) sendTemplate('new_inquiry', other.email, { name: other.name, subject: conv.subject, link: `${APP_URL()}/dashboard/messages/${conv._id}` });
  return message;
}

async function loadConversation(req) {
  if (!isObjectId(req.params.id)) throw new HttpError(404, 'Conversation not found.');
  const conv = await Conversation.findById(req.params.id);
  if (!conv || !isParticipant(conv, req.user._id)) throw new HttpError(404, 'Conversation not found.');   // authorization on every call
  return conv;
}

// GET /api/conversations
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit } = toPage(req.query);
  const q = { participants: req.user._id };
  const [rows, total] = await Promise.all([
    Conversation.find(q).sort({ lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).populate('participants', 'name companyName'),
    Conversation.countDocuments(q)
  ]);
  const me = String(req.user._id);
  res.json({
    conversations: rows.map((c) => ({ ...c.toJSON(), unread: (c.unread && c.unread.get(me)) || 0, blocked: c.blockedBy.length > 0 })),
    total, page, pages: Math.ceil(total / limit)
  });
}));

// GET /api/conversations/:id  – returns messages and marks them read
router.get('/:id', asyncHandler(async (req, res) => {
  const conv = await loadConversation(req);
  const messages = await ChatMessage.find({ conversation: conv._id }).sort({ createdAt: 1 }).limit(500);
  await ChatMessage.updateMany({ conversation: conv._id, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
  conv.unread.set(String(req.user._id), 0);
  await conv.save();
  const people = await User.find({ _id: { $in: conv.participants } }).select('name companyName');
  res.json({ conversation: conv, participants: people, messages });
}));

// POST /api/conversations/:id/messages
router.post('/:id/messages', asyncHandler(async (req, res) => {
  const conv = await loadConversation(req);
  if (conv.blockedBy.length) throw new HttpError(403, 'This conversation is blocked.');
  const text = cleanText(req.body && req.body.text, 2000);
  if (!text) throw new HttpError(400, 'Message cannot be empty.');
  res.status(201).json({ message: await appendMessage(conv, req.user, text) });
}));

// POST /api/conversations/:id/block   |  POST /api/conversations/:id/unblock
router.post('/:id/block', asyncHandler(async (req, res) => {
  const conv = await loadConversation(req);
  if (!conv.blockedBy.some((u) => String(u) === String(req.user._id))) conv.blockedBy.push(req.user._id);
  await conv.save();
  res.json({ message: 'Conversation blocked.' });
}));
router.post('/:id/unblock', asyncHandler(async (req, res) => {
  const conv = await loadConversation(req);
  conv.blockedBy = conv.blockedBy.filter((u) => String(u) !== String(req.user._id));
  await conv.save();
  res.json({ message: 'Conversation unblocked.' });
}));

module.exports = router;
