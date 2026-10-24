const express = require('express');
const Message = require('../models/Message');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, isObjectId } = require('../utils/helpers');

const router = express.Router();
const isParticipant = (m, uid) => String(m.sender) === uid || String(m.receiver) === uid;

// POST /api/messages
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const me = String(req.user._id);
  const receiverId = String(b.receiverId || '');
  const text = cleanText(b.text, 2000);

  if (!isObjectId(receiverId) || receiverId === me) throw new HttpError(400, 'Invalid recipient.');
  if (!text) throw new HttpError(400, 'Message cannot be empty.');
  if (!(await User.exists({ _id: receiverId, isActive: true }))) throw new HttpError(404, 'Recipient not found.');

  // Legacy endpoint: the conversation id is ALWAYS derived server-side from the two participants.
  const conversationId = [me, receiverId].sort().join('_');

  // If the conversation already exists, the sender must already be part of it.
  const existing = await Message.findOne({ conversationId }).select('sender receiver');
  if (existing && !isParticipant(existing, me)) throw new HttpError(403, 'You are not part of this conversation.');

  const message = await Message.create({ conversationId, sender: req.user._id, receiver: receiverId, text });
  res.status(201).json({ message, conversationId });
}));

// GET /api/messages/:conversationId
router.get('/:conversationId', requireAuth, asyncHandler(async (req, res) => {
  const me = String(req.user._id);
  const conversationId = cleanText(req.params.conversationId, 120);
  const messages = await Message.find({ conversationId }).sort({ createdAt: 1 }).limit(500);
  if (!conversationId.split('_').includes(me) || (messages.length && messages.some((m) => !isParticipant(m, me)))) throw new HttpError(403, 'You are not part of this conversation.');
  res.json({ messages });
}));

module.exports = router;
